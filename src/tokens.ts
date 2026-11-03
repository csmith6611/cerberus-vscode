export interface Token {
  name: string;
  category: string;
  value: unknown;
  semantic?: boolean;
  description?: string;
  deprecated?: boolean | string;
  /** CSS custom property, e.g. --cerberus-colors-page-bg. */
  cssVar?: string;
  /** The preset or config file that defined the token (v2 spec only). */
  source?: string;
}
/** Recipe or slot recipe: each variant's values and the default value, keyed by variant name. */
export interface Recipe { variants: Record<string, string[]>; defaultVariants?: Record<string, string>; description?: string; deprecated?: boolean | string }
/** `themes` holds Panda theme variants (config.themes, e.g. elysium): tokens that override or add to `tokens`. */
export interface Manifest { schemaVersion: 1; tokens: Token[]; themes?: Record<string, Token[]>; recipes?: Record<string, Recipe>; generatedAt?: string }
function validateTokens(tokens: unknown): void {
  if (!Array.isArray(tokens)) throw new Error('Expected a token array');
  if (tokens.length > 100000) throw new Error('Token manifest exceeds 100,000 tokens');
  const names = new Set<string>();
  for (const token of tokens) {
    if (!token || typeof token.name !== 'string' || typeof token.category !== 'string' || !token.name.startsWith(token.category + '.') || !('value' in token)) throw new Error('Invalid token entry');
    if (names.has(token.name)) throw new Error(`Duplicate token: ${token.name}`);
    names.add(token.name);
    if (token.description !== undefined && typeof token.description !== 'string') throw new Error('Invalid description');
    if (token.deprecated !== undefined && typeof token.deprecated !== 'boolean' && typeof token.deprecated !== 'string') throw new Error('Invalid deprecation metadata');
    if (token.cssVar !== undefined && typeof token.cssVar !== 'string' || token.source !== undefined && typeof token.source !== 'string') throw new Error('Invalid token metadata');
  }
}
function validateRecipes(recipes: unknown): void {
  if (!recipes || typeof recipes !== 'object' || Array.isArray(recipes)) throw new Error('Invalid recipes');
  for (const recipe of Object.values(recipes)) {
    if (!recipe?.variants || typeof recipe.variants !== 'object' || !Object.values(recipe.variants).every(values => Array.isArray(values) && values.every(v => typeof v === 'string'))) throw new Error('Invalid recipe');
  }
}
/** Recipes from a resolved config's `theme.recipes` / `theme.slotRecipes` (Panda variant objects, keyed by value). */
export function recipesFromConfig(theme: any): Record<string, Recipe> {
  const entries = Object.entries({...theme?.recipes, ...theme?.slotRecipes}).flatMap(([name, recipe]: [string, any]) => recipe && typeof recipe === 'object' ? [[name, {
    variants: Object.fromEntries(Object.entries(recipe.variants ?? {}).map(([variant, values]) => [variant, Object.keys(values ?? {})])),
    ...(recipe.defaultVariants ? {defaultVariants: Object.fromEntries(Object.entries(recipe.defaultVariants).map(([k, v]) => [k, String(v)]))} : {}),
    ...(typeof recipe.description === 'string' ? {description: recipe.description} : {}),
    ...(typeof recipe.deprecated === 'boolean' || typeof recipe.deprecated === 'string' ? {deprecated: recipe.deprecated} : {})}]] : []);
  return Object.fromEntries(entries);
}
/** Panda v2 design-system spec (`panda codegen --spec`, styled-system/specs/design-system.json): only the parts read here. */
interface SpecToken { category: string; cssVar?: string; description?: string; deprecated?: boolean; deprecatedReason?: string; semantic?: boolean; source?: number }
interface SpecValue { token: string; theme?: string; condition?: string; value: string; refs?: string[] }
interface SpecRecipe { variants?: Record<string, {values?: string[]}>; defaultVariants?: Record<string, unknown>; description?: string; deprecated?: boolean | string }
interface SpecSource { name?: string; specifier?: string; file?: string }
interface SpecDocument {
  schemaVersion: unknown; tokens: Record<string, SpecToken>; values: SpecValue[]; themes?: Record<string, {source?: number}>;
  recipes?: Record<string, SpecRecipe>; slotRecipes?: Record<string, SpecRecipe>; sources?: {entries?: SpecSource[]};
}
function isSpec(data: any): boolean {
  return !!data && Array.isArray(data.values) && !!data.tokens && typeof data.tokens === 'object' && !Array.isArray(data.tokens);
}
/**
 * Converts a spec to a manifest. Spec values are pre-resolved, but themed values resolve their references against the
 * base primitives, while the CSS variable follows the theme's own. So a value that is a plain alias of its one ref
 * becomes `{ref}`, resolved per theme like an exported config; derived values (e.g. negative spacing) stay literal.
 */
function fromSpec(data: SpecDocument): Manifest {
  if (data.schemaVersion !== 1) throw new Error(`Unsupported Panda spec schemaVersion ${String(data.schemaVersion)}`);
  // token -> theme ('' for base) -> condition ('base' when absent) -> row
  const rows = new Map<string, Map<string, Map<string, SpecValue>>>();
  for (const row of data.values) {
    if (!row || typeof row.token !== 'string' || typeof row.value !== 'string') throw new Error('Invalid spec value entry');
    let themes = rows.get(row.token);
    if (!themes) rows.set(row.token, themes = new Map());
    let conditions = themes.get(row.theme ?? '');
    if (!conditions) themes.set(row.theme ?? '', conditions = new Map());
    conditions.set(row.condition ?? 'base', row);
  }
  const lookup = (token: string, theme: string, condition: string) => {
    const themes = rows.get(token);
    for (const conditions of [themes?.get(theme), themes?.get('')]) {
      const row = conditions?.get(condition) ?? conditions?.get('base');
      if (row) return row.value;
    }
  };
  const encode = (row: SpecValue, condition: string) => {
    const [ref] = row.refs ?? [];
    return row.refs?.length === 1 && (lookup(ref, row.theme ?? '', condition) === row.value || lookup(ref, '', condition) === row.value) ? `{${ref}}` : row.value;
  };
  // Present only when the spec was written with source tracking.
  const sourceName = (index?: number) => {
    const entry = index === undefined ? undefined : data.sources?.entries?.[index];
    return entry?.name ?? entry?.specifier ?? entry?.file;
  };
  // A theme's values come from the theme's own preset, not the one that first defined the token.
  const tokensFor = (theme: string) => Object.entries(data.tokens).flatMap(([name, meta]): Token[] => {
    const conditions = rows.get(name)?.get(theme);
    if (!conditions || !meta) return [];
    const values = Object.fromEntries([...conditions].map(([condition, row]) => [condition, encode(row, condition)]));
    const deprecated = meta.deprecated ? meta.deprecatedReason || true : undefined;
    const source = (theme ? sourceName(data.themes?.[theme]?.source) : undefined) ?? sourceName(meta.source);
    return [{name, category: meta.category, value: Object.keys(values).length === 1 && 'base' in values ? values.base : values,
      ...(meta.semantic ? {semantic: true} : {}), ...(meta.description ? {description: meta.description} : {}), ...(deprecated ? {deprecated} : {}),
      ...(meta.cssVar ? {cssVar: meta.cssVar} : {}), ...(source ? {source} : {})}];
  });
  const themes = Object.fromEntries(Object.keys(data.themes ?? {}).map(name => [name, tokensFor(name)]).filter(([, tokens]) => tokens.length));
  const recipes = Object.fromEntries(Object.entries({...data.recipes, ...data.slotRecipes}).map(([name, recipe]): [string, Recipe] => [name, {
    variants: Object.fromEntries(Object.entries(recipe?.variants ?? {}).map(([variant, spec]) => [variant, spec?.values ?? []])),
    ...(recipe?.defaultVariants ? {defaultVariants: Object.fromEntries(Object.entries(recipe.defaultVariants).map(([k, v]) => [k, String(v)]))} : {}),
    ...(recipe?.description ? {description: recipe.description} : {}), ...(recipe?.deprecated ? {deprecated: recipe.deprecated} : {})}]));
  return {schemaVersion: 1, tokens: tokensFor(''), ...(Object.keys(themes).length ? {themes} : {}), ...(Object.keys(recipes).length ? {recipes} : {})};
}
/** Reads an exported manifest or a Panda v2 design-system spec. */
export function readManifest(text: string): Manifest {
  let data = JSON.parse(text);
  if (isSpec(data)) data = fromSpec(data);
  if (data.schemaVersion !== 1 || !Array.isArray(data.tokens)) throw new Error('Expected a schemaVersion: 1 token manifest or Panda design-system spec');
  validateTokens(data.tokens);
  if (data.themes !== undefined) {
    if (!data.themes || typeof data.themes !== 'object' || Array.isArray(data.themes)) throw new Error('Invalid themes');
    Object.values(data.themes).forEach(validateTokens);
  }
  if (data.recipes !== undefined) validateRecipes(data.recipes);
  return data;
}
/** The token set in effect under a theme variant: theme tokens replace same-named base tokens (keeping base metadata they lack). */
export function applyTheme(manifest: Manifest, theme?: string): Token[] {
  const overrides = theme && Object.hasOwn(manifest.themes ?? {}, theme) ? manifest.themes![theme] : undefined;
  if (!overrides?.length) return manifest.tokens;
  const byName = new Map(overrides.map(t => [t.name, t]));
  const merged = manifest.tokens.map(t => byName.has(t.name) ? {...t, ...byName.get(t.name)} : t);
  const known = new Set(manifest.tokens.map(t => t.name));
  return [...merged, ...overrides.filter(t => !known.has(t.name))];
}
export function shortName(token: Token): string { return token.name.slice(token.category.length + 1); }
export function flattenTokens(tree: unknown, semantic = false): Token[] {
  const result: Token[] = [];
  function walk(node: unknown, path: string[]) {
    if (!node || typeof node !== 'object') return;
    const obj = node as Record<string, unknown>;
    if ('value' in obj) {
      if (path.length < 2) return;
      result.push({name: path.filter(part => part !== 'DEFAULT').join('.'), category: path[0], value: obj.value, semantic,
        ...(typeof obj.description === 'string' ? {description: obj.description} : {}),
        ...(typeof obj.deprecated === 'boolean' || typeof obj.deprecated === 'string' ? {deprecated: obj.deprecated} : {})});
    } else for (const [key, child] of Object.entries(obj)) walk(child, [...path, key]);
  }
  walk(tree, []);
  return result;
}
export function mergeTokens(primitives: unknown, semantic: unknown): Token[] {
  return [...new Map([...flattenTokens(primitives), ...flattenTokens(semantic, true)].map(t => [t.name, t])).values()];
}
export interface Resolution { value: unknown; chain: string[]; unresolved?: boolean }
export function resolveToken(token: Token, tokens: Token[], condition = 'base', seen = new Set<string>()): Resolution {
  if (seen.has(token.name)) return {value: '[circular reference]', chain: [token.name], unresolved: true};
  const visited = new Set(seen).add(token.name);
  let value = token.value;
  // Objects without a base/condition key may be composite tokens (e.g. shadows).
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    if (condition in obj || 'base' in obj) value = obj[condition] ?? obj.base;
  }
  const chain = [token.name];
  let unresolved = false;
  if (typeof value === 'string') {
    value = value.replace(/\{([^{}]+)\}/g, (original, name: string) => {
      const next = tokens.find(t => t.name === name);
      if (!next) { unresolved = true; return original; }
      const resolved = resolveToken(next, tokens, condition, visited);
      chain.push(...resolved.chain);
      unresolved ||= !!resolved.unresolved;
      return typeof resolved.value === 'object' ? JSON.stringify(resolved.value) : String(resolved.value);
    });
  }
  return {value, chain: [...new Set(chain)], unresolved};
}
export function conditionsFor(token: Token, tokens: Token[], seen = new Set<string>()): string[] {
  if (seen.has(token.name)) return [];
  const visited = new Set(seen).add(token.name);
  const value = token.value;
  const result = new Set<string>(['base']);
  if (value && typeof value === 'object' && !Array.isArray(value) && 'base' in value) Object.keys(value).forEach(k => result.add(k));
  for (const match of JSON.stringify(value)?.matchAll(/\{([^{}]+)\}/g) ?? []) {
    const next = tokens.find(t => t.name === match[1]);
    if (next) conditionsFor(next, tokens, visited).forEach(c => result.add(c));
  }
  return [...result];
}
// Plain CSS colour syntax only: values reach editor CSS, and var()/currentColor cannot be previewed.
const cssColor = /^(#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([\w\s.,%/+-]*\)|[a-z]+)$/i;
const notColors = new Set(['currentcolor', 'inherit', 'initial', 'unset', 'revert', 'none']);
function asColor(result: Resolution): string | undefined {
  const value = typeof result.value === 'string' && !result.unresolved ? result.value.trim() : '';
  return cssColor.test(value) && !notColors.has(value.toLowerCase()) ? value : undefined;
}
export type SwatchMode = 'both' | 'light' | 'dark';
/**
 * Previewable colours for a colour token. 'light'/'dark' use the first condition named light/dark (e.g. _dark, _lightMode),
 * falling back to base; 'both' gives the distinct [light, dark] pair.
 */
export function swatchColors(token: Token, tokens: Token[], mode: SwatchMode = 'both'): string[] {
  if (token.category !== 'colors') return [];
  const base = asColor(resolveToken(token, tokens));
  if (!base) return [];
  const conditions = conditionsFor(token, tokens);
  const pick = (name: string) => {
    const condition = conditions.find(c => c.toLowerCase().includes(name));
    return (condition && asColor(resolveToken(token, tokens, condition))) || base;
  };
  return mode === 'both' ? [...new Set([pick('light'), pick('dark')])] : [pick(mode)];
}
