# Cerberus Tokens — VS Code MVP

Design-token help for Cerberus/Panda projects: completions, hovers, colour swatches and deprecation warnings, using your project's own tokens.

It runs locally: no telemetry, no network service. This is a development MVP, not a Marketplace release.

## Features

**Completion and insertion**

- Token completions in Cerberus JSX components, factory components, `css()` / `cva()` / `sva()` and recipe objects, including nested conditions.
- Covers common colour, spacing, size, typography, radius, shadow, duration and z-index properties.
- Recipe variants: `<Button palette="` suggests the `button` recipe's palettes, with the default marked. See [Recipe variants](#recipe-variants).
- **Cerberus: Insert Token**: a searchable token picker.

**Hovers**

- Description, primitive or semantic, conditional values and alias chains (circular references are detected).
- The CSS variable, e.g. `var(--cerberus-colors-page-bg-initial)`.
- Where the token is defined, e.g. `Defined in @cerberus/preset-elysium-theme` (Panda v2 only).
- **Cerberus: Copy CSS Variable** copies `var(--…)` for the token under the cursor, or one you pick.

**Colour swatches**

- A swatch after each colour token, like VS Code's CSS colour decorators.
- Tokens with different light and dark values show a split swatch. See [Colour swatches](#colour-swatches).

**Deprecations**

- Deprecated tokens are labelled, struck through and reported with the reason. Semantic tokens are ranked first.

**Projects and themes**

- In trusted workspaces, tokens load automatically from `panda.config.*` and stay in memory. No JSON required.
- Works with several apps in a monorepo. Each file uses the nearest token index above it.
- Exported JSON indexes refresh automatically. **Cerberus: Refresh Tokens** reloads everything.
- Brand themes (e.g. Elysium) are detected from `data-panda-theme`. See [Brand themes](#brand-themes).

### Colour swatches

The top-left half of a split swatch is light, the bottom-right dark. A title-bar button cycles the mode (`cerberus.swatchMode`):

| Mode | Shows |
| --- | --- |
| `auto` (default) | Follows the app's `data-color-mode`. With `system` or no value, both. |
| `both` | Light and dark |
| `light` / `dark` | One side only |

Light and dark use a condition whose name contains `light` or `dark` (e.g. `_dark`, `_lightMode`), otherwise `base`. Turn swatches off with `cerberus.colorSwatches`.

### Brand themes

A static `data-panda-theme="elysium"` anywhere in the repo selects that Panda `config.themes` variant. Hovers, completions and swatches then show the brand's values (e.g. `action.text.100` → Elysium's `brand.40`). `data-color-mode` is found the same way.

- **Search:** source files, excluding `node_modules`, build output and `styled-system`. It runs once, updates on save, and reruns on **Refresh Tokens**.
- **Several matches:** a match inside the app's root wins, then the one nearest the workspace root (ties by path).
- **Override:** set `cerberus.theme`.

### Recipe variants

Works on components and on recipe functions imported from `styled-system/recipes`, e.g. `button({size: '…'})`. Components match recipes by name: `Button` → `button`, `ButtonGroup` → `buttonGroup`, `Accordion.Root` → `accordion`.

### Insert Token

Inside a token string, it replaces the string's contents. Anywhere else, it inserts the full token name.

### Deprecation severity

`cerberus.deprecations` sets how they're reported: `warning` (default), `information`, `hint` (keeps them out of the Problems panel), or `off`.

## Install the packaged extension

Download the latest `cerberus-tokens-<version>.vsix` from [Releases](https://github.com/csmith6611/cerberus-vscode/releases). In VS Code, open Extensions → `…` → **Install from VSIX…** and select it.

In a trusted workspace with a `panda.config.*`, tokens load automatically (see below). Keep the extracted source folder only if you need the optional exporter.

## Connect your project

Usually nothing to do: open your application in VS Code and **trust the workspace**. The extension finds each `panda.config.{ts,mts,cts,js,mjs,cjs}` (outside `node_modules`), loads the **resolved Panda configuration** with your project's own Panda version, and keeps the tokens in memory. Presets, factory-generated tokens, semantic `base`/`_dark` values and local overrides are included. Nothing is written to your project. Token features activate in JS, JSX, TS and TSX files beneath the config.

Requirements: dependencies installed and `@pandacss/dev` present, **Panda v1 or v2** (detected automatically; npm, yarn and pnpm layouts work).

- **When it regenerates:** on window load, when a `panda.config.*` file is saved, and on **Cerberus: Refresh Tokens**. Changes to files the config imports (e.g. a separate `theme.ts`) or a preset upgrade need **Refresh Tokens**.
- **Security:** loading the config executes it and its imports, like running Panda. This happens only in trusted workspaces and in a separate Node process, never in the extension host. In Restricted Mode, only exported JSON indexes are read.
- **Turn it off** with `"cerberus.autoGenerate": false`. Progress shows in the status bar; failures are logged to the **Cerberus Tokens** output channel.

### Exported index (optional)

To pin tokens, or for untrusted workspaces and setups where the config can't load inside VS Code, export a static index. A `cerberus.tokens.json` beside a `panda.config.*` takes precedence over the generated tokens. From the extracted extension source folder:

```sh
npm ci
npm run compile
node scripts/export-tokens.cjs --cwd /absolute/path/to/your/app
```

For a nonstandard config location:

```sh
node scripts/export-tokens.cjs --cwd /absolute/path/to/your/app --config config/panda.config.ts
```

This creates `cerberus.tokens.json` in the application root. Re-run it after changing the theme; JSON changes are picked up automatically.

**Panda v2 design-system spec:** a spec written by Panda itself also works as an index, with no exporter needed. Write it to the application root under the manifest name, for example `panda codegen --spec cerberus.tokens.json` (Panda 2.4; newer releases also have a spec command). A spec at its default `styled-system/specs/design-system.json` is not picked up automatically, because tokens apply to files beneath the index's folder.

## Try it without a Panda project

Open the included `examples` folder in VS Code, open `example.tsx`, place the cursor inside a token string and invoke completion or **Cerberus: Insert Token**. The sample manifest is illustrative, not an authoritative Cerberus theme. Missing React/Cerberus imports in this standalone sample do not prevent this extension's providers from running.

## Settings

For custom generated import paths or local wrapper components:

```json
{
  "cerberus.importRoots": ["@/styled-system", "@company/styles"],
  "cerberus.components": ["AppPanel", "AppText"],
  "cerberus.manifestGlob": "**/cerberus.tokens.json",
  "cerberus.autoGenerate": true,
  "cerberus.theme": "elysium",
  "cerberus.swatchMode": "auto"
}
```

`manifestGlob` is relative to each workspace folder. Place the index at the root of the app it describes. A manifest in an unrelated sibling directory is intentionally not used. The index filename can be customized with `--out` and `manifestGlob` together.

Style-property completions insert short names such as `page.bg.initial`. The imported `token()` helper uses full names such as `colors.page.bg.initial`. For plain CSS, **Copy CSS Variable** copies `var(--…)`.

## Development

```sh
npm ci
npm test
npm run package
```

Open this folder in VS Code and press F5 using **Run Extension** to launch an Extension Development Host. In that host open `examples` or a real application with an exported manifest.

### Releasing

CI runs the tests and builds the VSIX on every push to `main` and every pull request, and fails if `CHANGELOG.md` has no section for the current `package.json` version. To publish a release:

1. Bump `version` in `package.json` and add a matching `# <version>` section to `CHANGELOG.md`.
2. Commit, push `main`, and wait for CI to pass.
3. Tag that commit with the version from `package.json` and push the tag:

```sh
version=v$(node -p "require('./package.json').version")
git tag -a "$version" -m "$version" && git push origin "$version"
```

A tag that fails is not reused: bump to the next version rather than moving it.

The Release workflow checks that the tag matches `package.json`, runs the tests, builds the VSIX and publishes a GitHub Release with it attached and the CHANGELOG section as notes.

## Compatibility and limits

- Panda v1 and v2 are both supported, using the project's own install. v2 is detected by the `@pandacss/dev/node` entry point and read from the compiler's design-system spec (`createNodeDriver().specJson()`), falling back to `loadConfig` when the spec is unavailable (e.g. no native compiler binary for the platform); v1 uses `@pandacss/node`'s `loadConfigAndCreateContext`. Export integration is tested with Panda 1.12.1 and 2.4.0 (real config loaders, presets, theme variants, local overrides, a TypeScript config). Other versions must expose the same API; compatibility with the consuming application's exact version needs verification.
- Cerberus source inspected at commit `2aab4d50f6c6077a7fbafbcc84545a69ff4872c6`. This implementation is independent of that repository and is not an official Omni Federal or Cerberus release.
- Automated tests cover parsing, replacement ranges, nested styles, aliases, deprecation metadata, manifest validation, circular references and export. Interactive VS Code host behavior still needs the manual check below.
- Design-system spec (schemaVersion 1): values are taken as Panda resolved them. A themed value that is an alias of one token is kept as that reference, so it follows the theme's own primitives as the CSS variable does at runtime (the spec's flat themed values are resolved against base primitives). Derived and composite values stay literal. Recipes, patterns and the spec's other sections are not used yet.
- The default theme and each named `config.themes` variant are exported. Theme detection reads static attribute values only (`data-panda-theme="elysium"`); a value computed at runtime (e.g. from `useTheme`) is not followed, so set `cerberus.theme` instead. One theme applies per token index; in a monorepo with one root config and several apps on different themes, the highest wins, so set `cerberus.theme` per folder if needed.
- Deprecation diagnostics cover open, visible editors, not the whole workspace. Recipe components are matched by name only; a recipe named differently from its component (e.g. `switchRecipe`) is not offered. Derived tokens (e.g. negative spacing) have no CSS variable of their own. CSS variables need a regenerated index (v2 spec or v1 config); older exported JSON files have none.
- `colorPalette.*` dynamic alias resolution, source navigation, migration actions and component scaffolding are future work.
- Recognizes imported helpers and imported components syntactically. It does not perform full TypeScript symbol resolution: re-exports, helper aliases beyond imports, local shadowing and custom utilities need additional support. Register local component wrappers with `cerberus.components`.
- Property/category mappings cover common built-in Panda properties; project-specific utilities are not inferred.
- The index can be read before `styled-system` is generated, but the extension does not replace Panda codegen, generated types, or TypeScript configuration.
- Swatches only render plain CSS colour values (hex, `rgb()`, `hsl()`, `oklch()`, named colours, etc.). Values using `var()`, `currentColor` or Panda opacity modifiers like `red.500/50` show no swatch.
- The picker shows resolved values as text. It does not render a live component preview or certify color contrast.

## Manual acceptance check

1. Install the VSIX and open `examples/example.tsx`.
2. Trigger completion inside `bgColor`: expect color tokens, with semantic tokens first.
3. Trigger completion inside `p`: expect spacing tokens.
4. Expect a split light/dark swatch after each `page.bg.initial` string, and none after `p="4"`. Click the title-bar circle: swatches switch to light, then dark, then back to split.
5. Hover the page background: expect base and `_dark` values and an alias chain.
6. Run Insert Token inside a string: only its contents should change, preserving quotes.
7. Move the cursor while the picker is open: insertion should be cancelled.
8. Edit the sample JSON value, save, and hover again: expect the updated value.
9. Open `examples/layout.tsx` (`data-panda-theme="elysium"`, `data-color-mode="dark"`): swatches in `example.tsx` show Elysium's dark purple, hovers say `Theme: elysium`. Change it to `data-color-mode="light"`, save: swatches turn light. Remove `data-panda-theme`: base values return.
10. Open an app with a `panda.config.ts` and no JSON index, trust the workspace: expect tokens and swatches to appear after the status bar shows generation.
11. In an app on Panda v2, hover a semantic token: expect `var(--…)` and `Defined in …`. Run **Copy CSS Variable** inside it and paste. Type `<Button palette="` and expect the palette values. Use a deprecated token (e.g. `page.bg.initial` in Cerberus): expect a struck-through warning.
12. Confirm no suggestions appear in `unrelated` or the native `<div title>` example.
13. Repeat with your application's exported manifest and its own Panda version.

## License

MIT. TypeScript and other packaged dependencies retain their respective licenses. No Cerberus source or assets are redistributed by this project.
