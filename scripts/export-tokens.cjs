#!/usr/bin/env node
// Explicit CLI invocation executes the project's Panda configuration.
const fs = require('node:fs/promises');
const path = require('node:path');
const {createRequire} = require('node:module');
const {pathToFileURL} = require('node:url');
const {mergeTokens, readManifest, recipesFromConfig} = require('../dist/tokens.js');
/** `cssVars` maps token name to CSS variable, when the loader exposes Panda's token dictionary (v1). */
function manifestFromConfig(config, cssVars = new Map()) {
  if (!config?.theme) throw new Error('Panda did not return a resolved theme.');
  const withVars = tokens => tokens.map(token => cssVars.has(token.name) ? {...token, cssVar: cssVars.get(token.name)} : token);
  const themes = Object.fromEntries(Object.entries(config.themes ?? {}).map(([name, variant]) => [name, withVars(mergeTokens(variant?.tokens, variant?.semanticTokens))]));
  const recipes = recipesFromConfig(config.theme);
  return {schemaVersion: 1, tokens: withVars(mergeTokens(config.theme.tokens, config.theme.semanticTokens)),
    ...(Object.keys(themes).length ? {themes} : {}), ...(Object.keys(recipes).length ? {recipes} : {})};
}
// Panda v2: @pandacss/dev/node (ESM). Only v2 has that entry point, so it also tells the versions apart; returns undefined on v1.
// Prefers the compiler's design-system spec (Panda's own resolution); falls back to loadConfig's resolved, preset-merged config.
async function loadV2Manifest(fromProject, cwd, configPath) {
  let entry;
  try { entry = fromProject.resolve('@pandacss/dev/node'); } catch { return undefined; }
  const {createNodeDriver, loadConfig} = await import(pathToFileURL(entry).href);
  const relative = configPath ? path.relative(cwd, path.resolve(cwd, configPath)) : undefined;
  if (typeof createNodeDriver === 'function') {
    try {
      const spec = (await createNodeDriver({cwd, trackSources: true, ...(relative ? {configPath: relative} : {})})).specJson?.();
      if (spec) return readManifest(spec);
    } catch { /* e.g. no native compiler binary for this platform; loadConfig below reports config errors */ }
  }
  if (typeof loadConfig !== 'function') throw new Error('This Panda v2 version exposes neither a design-system spec nor loadConfig. See README compatibility notes.');
  return manifestFromConfig((await loadConfig({cwd, ...(relative ? {file: relative} : {})})).config);
}
async function loadV1Manifest(fromProject, cwd, configPath) {
  let loader;
  try { loader = fromProject('@pandacss/node'); }
  catch {
    // @pandacss/dev depends on @pandacss/node, so use that copy when it is not hoisted (e.g. pnpm).
    try { loader = createRequire(fromProject.resolve('@pandacss/dev'))('@pandacss/node'); }
    catch (cause) { throw new Error('Could not load Panda from the project. Install @pandacss/dev.', {cause}); }
  }
  if (typeof loader.loadConfigAndCreateContext !== 'function') throw new Error('This Panda version does not expose loadConfigAndCreateContext. See README compatibility notes.');
  const ctx = await loader.loadConfigAndCreateContext({cwd, ...(configPath ? {configPath: path.resolve(cwd, configPath)} : {})});
  const cssVars = new Map((ctx.tokens?.allTokens ?? []).filter(t => typeof t.extensions?.var === 'string').map(t => [t.name, t.extensions.var]));
  return manifestFromConfig(ctx.config, cssVars);
}
async function main() {
  const args = process.argv.slice(2);
  const allowed = new Set(['--cwd', '--config', '--out']);
  const opts = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!allowed.has(args[i]) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Usage: export-tokens.cjs [--cwd project] [--config panda.config.ts] [--out cerberus.tokens.json]');
    opts[args[i].slice(2)] = args[i + 1];
  }
  const cwd = path.resolve(opts.cwd || process.cwd());
  const fromProject = createRequire(path.join(cwd, 'package.json'));
  // Resolve the project's Panda version, never the extension's dev dependency.
  const manifest = {generatedAt: new Date().toISOString(),
    ...(await loadV2Manifest(fromProject, cwd, opts.config) ?? await loadV1Manifest(fromProject, cwd, opts.config))};
  if (!manifest.tokens.length) throw new Error('Resolved theme contains no tokens; refusing to overwrite the index.');
  const target = path.resolve(cwd, opts.out || 'cerberus.tokens.json');
  const text = JSON.stringify(manifest, null, 2) + '\n';
  readManifest(text);
  await fs.mkdir(path.dirname(target), {recursive: true});
  const tmp = target + '.tmp-' + process.pid;
  try { await fs.writeFile(tmp, text); await fs.rename(tmp, target); }
  finally { await fs.rm(tmp, {force: true}); }
  console.log(`Exported ${manifest.tokens.length} tokens to ${target}`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
