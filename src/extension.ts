import * as vscode from 'vscode';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Manifest, Recipe, Token, applyTheme, conditionsFor, readManifest, resolveToken, shortName, swatchColors, SwatchMode } from './tokens';
import { getContext, getContexts, highestThemeAttributes, readThemeAttributes, StyleContext, ThemeAttributes } from './context';

const decoder = new TextDecoder();
const configGlob = '**/panda.config.{ts,mts,cts,js,mjs,cjs}';
const defaultManifestGlob = '**/cerberus.tokens.json';
const excluded = '**/{node_modules,.git,dist}/**';
// Files scanned (grep-style) for <html data-panda-theme data-color-mode>, anywhere in the workspace.
const sourceGlob = '**/*.{tsx,jsx,ts,js,mjs,html,astro,vue,svelte}';
const sourcePath = /\.(tsx|jsx|ts|js|mjs|html|astro|vue|svelte)$/;
const scanExcluded = '**/{node_modules,.git,dist,build,out,.next,.turbo,coverage,styled-system,storybook-static}/**';
/** A loaded token index, with the theme variant already applied to `manifest.tokens`. */
interface Index { manifest: Manifest; theme?: string; colorMode?: string }
const indexes = new Map<string, Index>();
function config(uri: vscode.Uri) { return vscode.workspace.getConfiguration('cerberus', uri); }
function options(uri: vscode.Uri) {
  return {importRoots: config(uri).get<string[]>('importRoots', []), components: config(uri).get<string[]>('components', []), recipes: indexFor(uri)?.manifest.recipes};
}
function inside(child: vscode.Uri, parent: vscode.Uri) {
  return child.scheme === parent.scheme && child.authority === parent.authority && (child.path === parent.path || child.path.startsWith(parent.path.replace(/\/$/, '') + '/'));
}
function indexFor(uri: vscode.Uri): Index | undefined {
  // Closest index wins, allowing multiple applications in a monorepo.
  const matches = [...indexes].map(([path, index]) => ({uri: vscode.Uri.parse(path), index}))
    .filter(item => inside(uri, vscode.Uri.joinPath(item.uri, '..')))
    .sort((a, b) => b.uri.path.length - a.uri.path.length);
  return matches[0]?.index;
}
/** Every workspace file with a static data-panda-theme or data-color-mode, by URI. */
async function scanThemeFiles(): Promise<Map<string, ThemeAttributes>> {
  const found = new Map<string, ThemeAttributes>();
  const uris = await vscode.workspace.findFiles(sourceGlob, scanExcluded, 20000);
  for (let i = 0; i < uris.length; i += 64) await Promise.all(uris.slice(i, i + 64).map(async uri => {
    try {
      const text = decoder.decode(await vscode.workspace.fs.readFile(uri));
      if (!text.includes('data-panda-theme') && !text.includes('data-color-mode')) return;
      const attributes = readThemeAttributes(text);
      if (attributes.theme || attributes.colorMode) found.set(uri.toString(), attributes);
    } catch { /* unreadable files are skipped */ }
  }));
  return found;
}
/** The cerberus.theme setting, else the highest static attributes found for this app root. */
function pickTheme(files: Map<string, ThemeAttributes>, root: vscode.Uri): ThemeAttributes {
  const found = highestThemeAttributes([...files].map(([key, attributes]) => [vscode.Uri.parse(key).path, attributes]), root.path);
  return {theme: config(root).get<string>('theme', '') || found.theme, colorMode: found.colorMode};
}
/** 'auto' follows the app's data-color-mode; 'system' or no attribute shows both. */
function swatchMode(uri: vscode.Uri, index: Index): SwatchMode {
  const mode = config(uri).get<SwatchMode | 'auto'>('swatchMode', 'auto');
  if (mode !== 'auto') return mode;
  return index.colorMode === 'light' || index.colorMode === 'dark' ? index.colorMode : 'both';
}
function context(document: vscode.TextDocument, position: vscode.Position) {
  return getContext(document.getText(), document.offsetAt(position), options(document.uri));
}
function candidates(manifest: Manifest, ctx: StyleContext): Token[] {
  return manifest.tokens.filter(t => ctx.category === '*' || t.category === ctx.category)
    .sort((a, b) => Number(!!a.deprecated) - Number(!!b.deprecated) || Number(!!b.semantic) - Number(!!a.semantic) || a.name.localeCompare(b.name));
}
const lookups = new WeakMap<Manifest, Map<string, Token>>();
function lookup(manifest: Manifest) {
  let byName = lookups.get(manifest);
  if (!byName) lookups.set(manifest, byName = new Map(manifest.tokens.map(t => [t.name, t])));
  return byName;
}
function swatch(range: vscode.Range, colors: string[]): vscode.DecorationOptions {
  // A zero-size box whose borders form the square; two colours split it diagonally (base / other mode).
  const [base, other = base] = colors;
  return {range, renderOptions: {after: {contentText: '', width: '0', height: '0', border: '0.5em solid', borderColor: `${base} ${other} ${other} ${base}`, margin: '0.1em 0.2em 0 0.2em'}}};
}
function display(value: unknown): string { return typeof value === 'string' ? value : JSON.stringify(value) ?? 'undefined'; }
function hover(token: Token, {manifest, theme}: Index): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.appendCodeblock(token.name, 'text');
  if (token.cssVar) md.appendCodeblock(`var(${token.cssVar})`, 'css');
  if (theme) md.appendText(`Theme: ${theme}\n\n`);
  if (token.source) md.appendText(`Defined in ${token.source}\n\n`);
  if (token.deprecated) md.appendText(`Deprecated${typeof token.deprecated === 'string' ? ': ' + token.deprecated : ''}\n\n`);
  if (token.description) md.appendText(token.description + '\n\n');
  md.appendText(token.semantic ? 'Semantic token\n\n' : 'Primitive token\n\n');
  for (const condition of conditionsFor(token, manifest.tokens)) {
    const result = resolveToken(token, manifest.tokens, condition);
    md.appendText(`${condition}: ${display(result.value)}${result.unresolved ? ' (unresolved)' : ''}\n\n`);
    if (result.chain.length > 1) md.appendText(`${result.chain.join(' → ')}\n\n`);
  }
  // Untrusted project text stays plain text; command links/HTML are disabled.
  md.isTrusted = false;
  return md;
}
function variantHover(name: string, variant: string, recipe: Recipe): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.appendCodeblock(`${name}.${variant}`, 'text');
  if (recipe.deprecated) md.appendText(`Deprecated${typeof recipe.deprecated === 'string' ? ': ' + recipe.deprecated : ''}\n\n`);
  if (recipe.description) md.appendText(recipe.description + '\n\n');
  md.appendText(`Values: ${recipe.variants[variant].join(' | ')}\n\n`);
  if (recipe.defaultVariants?.[variant] !== undefined) md.appendText(`Default: ${recipe.defaultVariants[variant]}\n\n`);
  md.isTrusted = false;
  return md;
}
/** A token completion; its documentation is built in resolveCompletionItem, only for the item the user focuses. */
class TokenCompletion extends vscode.CompletionItem {
  constructor(label: string, readonly token: Token, readonly index: Index) { super(label, vscode.CompletionItemKind.Value); }
}
/** The token a token-valued context names, if any. */
function tokenAt(manifest: Manifest, ctx: StyleContext): Token | undefined {
  return ctx.category === 'variant' ? undefined : lookup(manifest).get(ctx.fullName ? ctx.value : `${ctx.category}.${ctx.value}`);
}
const severities: Record<string, vscode.DiagnosticSeverity> = {warning: vscode.DiagnosticSeverity.Warning, information: vscode.DiagnosticSeverity.Information, hint: vscode.DiagnosticSeverity.Hint};
export async function activate(extension: vscode.ExtensionContext) {
  const output = vscode.window.createOutputChannel('Cerberus Tokens');
  extension.subscriptions.push(output);
  // Tokens generated in memory from each Panda config, keyed by config URI. Rejections are cached too,
  // so a broken config is not re-executed on every unrelated JSON change; config saves and Refresh Tokens clear it.
  // Each entry's controller kills its process when the entry is dropped (config saved, Refresh Tokens, deactivation).
  const generated = new Map<string, {manifest: Promise<Manifest>; controller: AbortController}>();
  function forget(key?: string) {
    for (const [k, entry] of generated) if (key === undefined || k === key) { entry.controller.abort(); generated.delete(k); }
  }
  async function generate(uri: vscode.Uri, signal: AbortSignal): Promise<Manifest> {
    // Loading the config executes project code, so it runs in a separate Node process (never in the extension host).
    const dir = await mkdtemp(join(tmpdir(), 'cerberus-tokens-'));
    const out = join(dir, 'tokens.json');
    try {
      await new Promise<void>((resolve, reject) => execFile(process.execPath,
        [extension.asAbsolutePath('scripts/export-tokens.cjs'), '--cwd', dirname(uri.fsPath), '--config', uri.fsPath, '--out', out],
        {cwd: dirname(uri.fsPath), env: {...process.env, ELECTRON_RUN_AS_NODE: '1'}, timeout: 120_000, signal},
        (error, _stdout, stderr) => error ? reject(new Error(stderr.trim() || error.message)) : resolve()));
      return readManifest(await readFile(out, 'utf8'));
    } finally { await rm(dir, {recursive: true, force: true}); }
  }
  function generatedTokens(uri: vscode.Uri): Promise<Manifest> {
    const key = uri.toString(), cached = generated.get(key);
    if (cached) return cached.manifest;
    const controller = new AbortController(), manifest = generate(uri, controller.signal);
    generated.set(key, {manifest, controller});
    // Reported here, once, so the error isn't lost when the refresh that started it is superseded.
    const settled = manifest.then(() => undefined, error => {
      if (controller.signal.aborted) return;
      output.appendLine(`${uri.fsPath}: ${error instanceof Error ? error.message : String(error)}`);
      void vscode.window.showWarningMessage('Some Cerberus tokens could not be loaded. See the Cerberus Tokens output channel.');
    });
    void vscode.window.withProgress({location: vscode.ProgressLocation.Window, title: 'Cerberus: generating tokens'}, () => settled);
    return manifest;
  }
  // Scanned once, then kept current on save; Refresh Tokens and workspace folder changes rescan.
  let themeFiles: Promise<Map<string, ThemeAttributes>> | undefined;
  let generation = 0;
  async function refresh(regenerate = false) {
    const current = ++generation;
    if (regenerate) { forget(); themeFiles = undefined; }
    const next = new Map<string, Manifest>();
    const errors: string[] = [];
    const manifestDirs = new Set<string>();
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const pattern = config(folder.uri).get<string>('manifestGlob', defaultManifestGlob);
      const uris = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, pattern), excluded, 200);
      for (const uri of uris) {
        manifestDirs.add(vscode.Uri.joinPath(uri, '..').toString());
        try {
          const stat = await vscode.workspace.fs.stat(uri);
          if (stat.size > 10 * 1024 * 1024) throw new Error('Manifest exceeds 10 MiB');
          next.set(uri.toString(), readManifest(decoder.decode(await vscode.workspace.fs.readFile(uri))));
        } catch (error) { errors.push(`${uri.fsPath}: ${String(error)}`); }
      }
    }
    const configs: vscode.Uri[] = [];
    for (const folder of vscode.workspace.isTrusted ? vscode.workspace.workspaceFolders ?? [] : []) {
      if (folder.uri.scheme !== 'file' || !config(folder.uri).get<boolean>('autoGenerate', true)) continue;
      for (const uri of await vscode.workspace.findFiles(new vscode.RelativePattern(folder, configGlob), excluded, 50)) {
        // An exported manifest beside the config is an explicit override.
        if (!manifestDirs.has(vscode.Uri.joinPath(uri, '..').toString())) configs.push(uri);
      }
    }
    // Generated concurrently, one process per config; failures are reported by generatedTokens.
    (await Promise.allSettled(configs.map(generatedTokens))).forEach((result, i) => {
      if (result.status === 'fulfilled') next.set(configs[i].toString(), result.value);
    });
    const themed = new Map<string, Index>();
    const files = next.size ? await (themeFiles ??= scanThemeFiles()).catch(() => new Map<string, ThemeAttributes>()) : new Map<string, ThemeAttributes>();
    for (const [key, manifest] of next) {
      const root = vscode.Uri.joinPath(vscode.Uri.parse(key), '..');
      let {theme, colorMode} = pickTheme(files, root);
      // A theme name without a matching variant (e.g. the default "cerberus") uses the base tokens.
      if (theme && !Object.hasOwn(manifest.themes ?? {}, theme)) theme = undefined;
      themed.set(key, {manifest: {...manifest, tokens: applyTheme(manifest, theme)}, theme, colorMode});
      output.appendLine(`${root.fsPath}: ${manifest.tokens.length} tokens, theme ${theme ?? 'base'}${colorMode ? `, color mode ${colorMode}` : ''}${manifest.themes ? ` (variants: ${Object.keys(manifest.themes).join(', ')})` : ''}`);
    }
    if (current !== generation) return;
    indexes.clear(); themed.forEach((value, key) => indexes.set(key, value));
    output.appendLine(`Loaded ${indexes.size} token index(es).`);
    errors.forEach(e => output.appendLine(e));
    if (errors.length) void vscode.window.showWarningMessage('Some Cerberus tokens could not be loaded. See the Cerberus Tokens output channel.');
    decorateVisible();
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  function scheduleRefresh() { clearTimeout(timer); timer = setTimeout(() => void refresh().catch(e => output.appendLine(String(e))), 200); }
  // One watcher per folder for its configured manifest glob, so unrelated JSON writes (build output, caches) don't refresh.
  let manifestWatchers: vscode.Disposable[] = [];
  function watchManifests() {
    manifestWatchers.forEach(d => d.dispose());
    manifestWatchers = (vscode.workspace.workspaceFolders ?? []).flatMap(folder => {
      const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, config(folder.uri).get<string>('manifestGlob', defaultManifestGlob)));
      return [watcher, watcher.onDidChange(scheduleRefresh), watcher.onDidCreate(scheduleRefresh), watcher.onDidDelete(scheduleRefresh)];
    });
  }
  watchManifests();
  const configWatcher = vscode.workspace.createFileSystemWatcher(configGlob);
  const configChanged = (uri: vscode.Uri) => { forget(uri.toString()); scheduleRefresh(); };
  extension.subscriptions.push({dispose: () => { manifestWatchers.forEach(d => d.dispose()); forget(); }},
    configWatcher, configWatcher.onDidChange(configChanged), configWatcher.onDidCreate(configChanged), configWatcher.onDidDelete(configChanged),
    vscode.workspace.onDidGrantWorkspaceTrust(scheduleRefresh),
    vscode.workspace.onDidSaveTextDocument(async document => {
      if (!themeFiles || !sourcePath.test(document.uri.path)) return;
      const files = await themeFiles, key = document.uri.toString(), before = files.get(key);
      const attributes = readThemeAttributes(document.getText());
      if (attributes.theme || attributes.colorMode) files.set(key, attributes); else files.delete(key);
      if (before?.theme !== attributes.theme || before?.colorMode !== attributes.colorMode) scheduleRefresh();
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => { themeFiles = undefined; watchManifests(); scheduleRefresh(); }), vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('cerberus.manifestGlob')) watchManifests();
      if (['manifestGlob', 'autoGenerate', 'theme'].some(key => e.affectsConfiguration(`cerberus.${key}`))) scheduleRefresh();
      else if (e.affectsConfiguration('cerberus')) decorateVisible();
    }),
    {dispose: () => clearTimeout(timer)}, vscode.commands.registerCommand('cerberus.refreshTokens', () => refresh(true)));
  const selector = [{language: 'typescriptreact'}, {language: 'javascriptreact'}, {language: 'typescript'}, {language: 'javascript'}];
  const swatchType = vscode.window.createTextEditorDecorationType({});
  const deprecations = vscode.languages.createDiagnosticCollection('cerberus');
  extension.subscriptions.push(deprecations, vscode.workspace.onDidCloseTextDocument(document => deprecations.delete(document.uri)));
  function decorate(editor: vscode.TextEditor) {
    const document = editor.document, index = indexFor(document.uri), manifest = index?.manifest;
    const decorations: vscode.DecorationOptions[] = [], diagnostics: vscode.Diagnostic[] = [];
    const swatches = config(document.uri).get<boolean>('colorSwatches', true);
    const severity = severities[config(document.uri).get<string>('deprecations', 'warning')];
    if (index && manifest && vscode.languages.match(selector, document) && (swatches || severity !== undefined)) {
      const mode = swatchMode(document.uri, index);
      const text = document.getText();
      for (const ctx of getContexts(text, options(document.uri))) {
        const token = tokenAt(manifest, ctx);
        if (!token) continue;
        if (token.deprecated && severity !== undefined) {
          const diagnostic = new vscode.Diagnostic(new vscode.Range(document.positionAt(ctx.start), document.positionAt(ctx.end)),
            `${token.name} is deprecated${typeof token.deprecated === 'string' ? ': ' + token.deprecated : '.'}`, severity);
          diagnostic.source = 'Cerberus';
          diagnostic.tags = [vscode.DiagnosticTag.Deprecated];
          diagnostics.push(diagnostic);
        }
        const colors = swatches ? swatchColors(token, manifest.tokens, mode) : [];
        if (colors.length) decorations.push(swatch(new vscode.Range(document.positionAt(ctx.start - 1), document.positionAt(Math.min(ctx.end + 1, text.length))), colors));
      }
    }
    editor.setDecorations(swatchType, decorations);
    deprecations.set(document.uri, diagnostics);
  }
  function decorateVisible() { vscode.window.visibleTextEditors.forEach(decorate); }
  let decorateTimer: ReturnType<typeof setTimeout> | undefined;
  extension.subscriptions.push(swatchType, {dispose: () => clearTimeout(decorateTimer)}, vscode.window.onDidChangeVisibleTextEditors(decorateVisible),
    vscode.workspace.onDidChangeTextDocument(e => {
      if (!vscode.window.visibleTextEditors.some(editor => editor.document === e.document)) return;
      clearTimeout(decorateTimer); decorateTimer = setTimeout(decorateVisible, 150);
    }));
  // The title-bar button shows the current mode; clicking it moves to the next one.
  const modes: (SwatchMode | 'auto')[] = ['auto', 'both', 'light', 'dark'];
  async function cycleSwatchMode() {
    const settings = vscode.workspace.getConfiguration('cerberus');
    const next = modes[(modes.indexOf(settings.get<SwatchMode | 'auto'>('swatchMode', 'auto')) + 1) % modes.length];
    const target = settings.inspect('swatchMode')?.workspaceValue !== undefined ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
    await settings.update('swatchMode', next, target);
  }
  extension.subscriptions.push(...['cerberus.toggleSwatchMode', ...modes.map(m => `cerberus.swatchMode.${m}`)].map(id => vscode.commands.registerCommand(id, cycleSwatchMode)));
  extension.subscriptions.push(vscode.languages.registerCompletionItemProvider(selector, {
    provideCompletionItems(document, position) {
      const index = indexFor(document.uri), manifest = index?.manifest, ctx = context(document, position);
      if (!index || !manifest || !ctx) return;
      if (ctx.category === 'variant') {
        const recipe = manifest.recipes![ctx.recipe!], fallback = recipe.defaultVariants?.[ctx.property];
        return recipe.variants[ctx.property].map((value, i) => {
          const item = new vscode.CompletionItem(value, vscode.CompletionItemKind.EnumMember);
          item.range = new vscode.Range(document.positionAt(ctx.start), document.positionAt(ctx.end));
          item.detail = `${ctx.recipe} ${ctx.property}${value === fallback ? ' (default)' : ''}`;
          item.documentation = variantHover(ctx.recipe!, ctx.property, recipe);
          item.sortText = String(i).padStart(6, '0');
          if (recipe.deprecated) item.tags = [vscode.CompletionItemTag.Deprecated];
          return item;
        });
      }
      return candidates(manifest, ctx).map((token, i) => {
        const name = ctx.fullName ? token.name : shortName(token);
        const item = new TokenCompletion(name, token, index);
        item.range = new vscode.Range(document.positionAt(ctx.start), document.positionAt(ctx.end));
        item.insertText = name;
        item.detail = `${token.semantic ? 'Semantic' : 'Primitive'} · ${display(resolveToken(token, manifest.tokens).value)}`;
        item.sortText = String(i).padStart(6, '0');
        if (token.deprecated) item.tags = [vscode.CompletionItemTag.Deprecated];
        return item;
      });
    },
    resolveCompletionItem(item) {
      if (item instanceof TokenCompletion) item.documentation = hover(item.token, item.index);
      return item;
    }
  }, '"', "'", '.'));
  extension.subscriptions.push(vscode.languages.registerHoverProvider(selector, {
    provideHover(document, position) {
      const index = indexFor(document.uri), ctx = context(document, position);
      if (!index || !ctx) return;
      const manifest = index.manifest, range = new vscode.Range(document.positionAt(ctx.start), document.positionAt(ctx.end));
      if (ctx.category === 'variant') return new vscode.Hover(variantHover(ctx.recipe!, ctx.property, manifest.recipes![ctx.recipe!]), range);
      const token = candidates(manifest, ctx).find(t => (ctx.fullName ? t.name : shortName(t)) === ctx.value);
      if (token) return new vscode.Hover(hover(token, index), range);
    }
  }));
  extension.subscriptions.push(vscode.commands.registerCommand('cerberus.insertToken', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    const manifest = indexFor(editor.document.uri)?.manifest;
    if (!manifest) {
      void vscode.window.showInformationMessage('No Cerberus tokens found for this file. Tokens load from panda.config in trusted workspaces, or from an exported cerberus.tokens.json.');
      return;
    }
    const document = editor.document, version = document.version;
    const selection = editor.selection;
    const found = context(document, selection.active);
    const ctx = found?.category === 'variant' ? undefined : found;
    const list = ctx ? candidates(manifest, ctx) : manifest.tokens;
    const picked = await vscode.window.showQuickPick(list.map(token => ({
      label: ctx && !ctx.fullName ? shortName(token) : token.name,
      description: `${token.deprecated ? '[deprecated] ' : ''}${display(resolveToken(token, manifest.tokens).value)}`,
      detail: token.description, token
    })), {placeHolder: ctx ? `Choose a ${ctx.category} token for ${ctx.property}` : 'Choose a token (inserts the full name)', matchOnDescription: true, matchOnDetail: true});
    if (!picked) return;
    if (vscode.window.activeTextEditor !== editor || document.version !== version || !editor.selection.isEqual(selection)) {
      void vscode.window.showInformationMessage('The document or selection changed. Run Insert Token again.'); return;
    }
    await editor.edit(edit => edit.replace(ctx ? new vscode.Range(document.positionAt(ctx.start), document.positionAt(ctx.end)) : selection, ctx && !ctx.fullName ? shortName(picked.token) : picked.token.name));
  }));
  // Copies var(--…) for the token under the cursor, else for a picked token.
  extension.subscriptions.push(vscode.commands.registerCommand('cerberus.copyCssVariable', async () => {
    const editor = vscode.window.activeTextEditor;
    const manifest = editor && indexFor(editor.document.uri)?.manifest;
    if (!editor || !manifest) {
      void vscode.window.showInformationMessage('No Cerberus tokens found for this file.'); return;
    }
    const ctx = context(editor.document, editor.selection.active);
    let token = ctx && tokenAt(manifest, ctx);
    if (!token?.cssVar) {
      const withVars = manifest.tokens.filter(t => t.cssVar);
      if (!withVars.length) {
        void vscode.window.showInformationMessage('This token index has no CSS variable names. Regenerate it with Refresh Tokens.'); return;
      }
      token = (await vscode.window.showQuickPick(withVars.map(t => ({label: t.name, description: t.cssVar, token: t})), {placeHolder: 'Copy the CSS variable for a token', matchOnDescription: true}))?.token;
    }
    if (!token?.cssVar) return;
    await vscode.env.clipboard.writeText(`var(${token.cssVar})`);
    vscode.window.setStatusBarMessage(`Copied var(${token.cssVar})`, 3000);
  }));
  // Config generation can take seconds; don't hold up activation for it.
  void refresh().catch(e => output.appendLine(String(e)));
}
