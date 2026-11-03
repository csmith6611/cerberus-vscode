import ts from 'typescript';

const categories: Record<string, string> = {};
function group(category: string, properties: string) { for (const p of properties.split(' ')) categories[p] = category; }
group('colors', 'color bg bgColor background backgroundColor borderColor borderTopColor borderBottomColor borderLeftColor borderRightColor outlineColor fill stroke textDecorationColor gradientFrom gradientTo gradientVia caretColor');
group('spacing', 'p px py pt pb pl pr padding paddingInline paddingBlock paddingTop paddingBottom paddingLeft paddingRight m mx my mt mb ml mr margin marginInline marginBlock marginTop marginBottom marginLeft marginRight gap rowGap columnGap spaceX spaceY top right bottom left inset');
group('radii', 'rounded borderRadius borderTopLeftRadius borderTopRightRadius borderBottomLeftRadius borderBottomRightRadius');
group('sizes', 'w h width height minW maxW minH maxH minWidth maxWidth minHeight maxHeight');
group('shadows', 'shadow boxShadow');
group('fonts', 'fontFamily'); group('fontSizes', 'fontSize'); group('fontWeights', 'fontWeight');
group('lineHeights', 'lineHeight'); group('letterSpacings', 'letterSpacing'); group('zIndex', 'zIndex');
group('durations', 'transitionDuration animationDuration'); group('easings', 'transitionTimingFunction animationTimingFunction');
/** Category 'variant': `property` is a variant of `recipe` (e.g. <Button palette="…"> or button({size: '…'})). */
export interface StyleContext { category: string; fullName: boolean; start: number; end: number; value: string; property: string; recipe?: string }
/** `recipes`: recipe name → variant names; variant contexts are reported only for these. */
export interface ContextOptions { importRoots?: string[]; components?: string[]; recipes?: Record<string, {variants: Record<string, unknown>}> }
/** Component to recipe name by convention: Button → button, ButtonGroup → buttonGroup, Accordion.Root → accordion. */
export function recipeName(tag: string): string { const root = tag.split('.')[0]; return root.charAt(0).toLowerCase() + root.slice(1); }
function nameOf(node: ts.Node): string { return ts.isIdentifier(node) || ts.isStringLiteral(node) ? node.text : ''; }
function prepare(text: string, options: ContextOptions) {
  const sf = ts.createSourceFile('file.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const funcs = new Set<string>(), namespaces = new Set<string>(), components = new Set(options.components ?? []);
  // Local name → recipe name, for recipe functions imported from <root>/recipes.
  const recipeFuncs = new Map<string, string>();
  const hasVariant = (recipe: string, variant: string) => !!options.recipes && Object.hasOwn(options.recipes, recipe) && Object.hasOwn(options.recipes[recipe].variants ?? {}, variant);
  const roots = ['styled-system', ...(options.importRoots ?? [])];
  for (const statement of sf.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const path = statement.moduleSpecifier.text;
    const panda = roots.some(r => path === r || path.startsWith(r + '/') || path.includes('/' + r + '/'));
    const cerberus = /^@cerberus(?:-design)?\/react(?:\/|$)/.test(path);
    const bindings = statement.importClause?.namedBindings;
    if (!bindings) continue;
    if (ts.isNamespaceImport(bindings)) { if (panda || cerberus) namespaces.add(bindings.name.text); continue; }
    for (const item of bindings.elements) {
      const original = item.propertyName?.text ?? item.name.text;
      if (panda && ['css', 'cva', 'sva', 'defineRecipe', 'defineSlotRecipe'].includes(original)) funcs.add(item.name.text);
      if (path === '@pandacss/dev' && ['defineRecipe', 'defineSlotRecipe', 'defineStyles'].includes(original)) funcs.add(item.name.text);
      if (cerberus || panda && /\/jsx$/.test(path)) components.add(item.name.text);
      if (panda && /\/recipes(?:\/|$)/.test(path)) recipeFuncs.set(item.name.text, original);
    }
  }
  function supportedCall(node: ts.CallExpression): boolean {
    const expr = node.expression;
    return ts.isIdentifier(expr) && funcs.has(expr.text) || ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.expression) && namespaces.has(expr.expression.text) && ['css', 'cva', 'sva'].includes(expr.name.text);
  }
  function supportedJSX(node: ts.JsxAttribute): boolean {
    const tag = (node.parent.parent as ts.JsxOpeningLikeElement).tagName.getText(sf);
    return components.has(tag) || components.has(tag.split('.')[0]) || namespaces.has(tag.split('.')[0]);
  }
  // token() must be imported from the project's styled-system/token entrypoint.
  const tokenImported = sf.statements.some(s => ts.isImportDeclaration(s) && ts.isStringLiteral(s.moduleSpecifier) && roots.some(r => s.moduleSpecifier.getText(sf).includes(r + '/tokens')) && s.importClause?.namedBindings && ts.isNamedImports(s.importClause.namedBindings) && s.importClause.namedBindings.elements.some(e => e.name.text === 'token'));
  function classify(str: ts.StringLiteralLike): StyleContext | undefined {
    const start = str.getStart(sf) + 1;
    const last = text[str.end - 1];
    const end = last === text[start - 1] && str.end > start ? str.end - 1 : str.end;
    // Avoid treating object keys and import module specifiers as values.
    if (ts.isPropertyAssignment(str.parent) && str.parent.name === str) return;
    if (ts.isCallExpression(str.parent) && ts.isIdentifier(str.parent.expression) && str.parent.expression.text === 'token') {
      if (tokenImported) return {category: '*', fullName: true, start, end, value: str.text, property: 'token'};
    }
    let property: string | undefined, outerKey: string | undefined;
    let valid = false;
    const variant = (recipe: string, key: string) => ({category: 'variant', fullName: false, start, end, value: str.text, property: key, recipe});
    for (let node: ts.Node = str.parent; node && !ts.isSourceFile(node); node = node.parent) {
      if (ts.isPropertyAssignment(node)) {
        const key = nameOf(node.name);
        if (categories[key]) property = key;
        outerKey = key;
      }
      if (ts.isJsxAttribute(node)) {
        const key = nameOf(node.name);
        // Recipe components take variant props before style props, as in Panda.
        const recipe = recipeName((node.parent.parent as ts.JsxOpeningLikeElement).tagName.getText(sf));
        if (supportedJSX(node) && hasVariant(recipe, key)) return variant(recipe, key);
        if (categories[key]) property = key;
        valid = supportedJSX(node) && (key === 'css' || key.startsWith('_') || !!categories[key]);
        break;
      }
      if (ts.isCallExpression(node)) {
        const recipe = ts.isIdentifier(node.expression) ? recipeFuncs.get(node.expression.text) : undefined;
        if (recipe && outerKey && hasVariant(recipe, outerKey)) return variant(recipe, outerKey);
        valid = supportedCall(node); break;
      }
    }
    if (!valid || !property) return;
    return {category: categories[property], fullName: false, start, end, value: str.text, property};
  }
  return {sf, classify};
}
export function getContext(text: string, offset: number, options: ContextOptions = {}): StyleContext | undefined {
  const {sf, classify} = prepare(text, options);
  let literal: ts.StringLiteralLike | undefined;
  function visit(node: ts.Node) {
    if (offset < node.getFullStart() || offset > node.end) return;
    if (ts.isStringLiteralLike(node) && offset > node.getStart(sf) && offset <= node.end) literal = node;
    ts.forEachChild(node, visit);
  }
  visit(sf);
  const ctx = literal && classify(literal);
  return ctx && offset <= ctx.end ? ctx : undefined;
}
/** Every token-valued (and, given `recipes`, variant-valued) string in the document, parsed once (used for decorations and diagnostics). */
export function getContexts(text: string, options: ContextOptions = {}): StyleContext[] {
  const {sf, classify} = prepare(text, options);
  const result: StyleContext[] = [];
  function visit(node: ts.Node) {
    const ctx = ts.isStringLiteralLike(node) && classify(node);
    if (ctx) result.push(ctx);
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return result;
}
/** Static `data-panda-theme` / `data-color-mode` attribute values (e.g. on the root <html>); dynamic expressions are ignored. */
export interface ThemeAttributes { theme?: string; colorMode?: string }
export function readThemeAttributes(text: string): ThemeAttributes {
  const attr = (name: string) => text.match(new RegExp(`\\b${name}\\s*=\\s*(?:\\{\\s*)?["'\`]([\\w-]+)["'\`]`))?.[1];
  return {theme: attr('data-panda-theme'), colorMode: attr('data-color-mode')};
}
/**
 * The highest (closest to the repo root) theme and colour mode among `files` (path → attributes): matches inside `root`
 * first, then anywhere, since a monorepo's Panda config and root layout often live in different packages.
 */
export function highestThemeAttributes(files: [string, ThemeAttributes][], root: string): ThemeAttributes {
  const prefix = root.replace(/\/$/, '') + '/';
  const local = files.filter(([path]) => path.startsWith(prefix));
  const depth = (path: string) => path.split('/').length;
  const pool = (local.length ? local : files).slice().sort(([a], [b]) => depth(a) - depth(b) || a.localeCompare(b));
  return {theme: pool.find(([, a]) => a.theme)?.[1].theme, colorMode: pool.find(([, a]) => a.colorMode)?.[1].colorMode};
}
