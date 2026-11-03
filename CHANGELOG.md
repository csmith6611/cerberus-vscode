# 0.1.0

Initial development MVP: token picker, context-aware completions, conditional-value hovers, deprecation metadata and an explicit project-config exporter.

# 0.2.0

Colour swatches after colour token strings, with a split swatch for tokens whose value differs by condition (e.g. `_dark`). Toggle with `cerberus.colorSwatches`.

# 0.3.0

Tokens load automatically from `panda.config.*` in trusted workspaces (separate process, in memory); no exported JSON needed. A `cerberus.tokens.json` beside the config still takes precedence. Toggle with `cerberus.autoGenerate`. The exporter now finds `@pandacss/node` through `@pandacss/dev` (pnpm). Larger swatches, and an editor title-bar button to cycle swatches between both, light and dark (`cerberus.swatchMode`).

# 0.4.0

Brand theme variants: `config.themes` (e.g. Elysium) are exported and applied based on the app's static `data-panda-theme`, so semantic tokens resolve through that brand's primitives. New `auto` swatch mode (default) follows `data-color-mode`. New `cerberus.theme` setting overrides detection.

# 0.4.1

Theme and colour-mode detection scans the whole workspace (monorepos), preferring matches inside the app root, then the highest in the repo, instead of only `layout`/`_document`/`index`-style files.

# 0.4.2

Panda v2 support: projects on `@pandacss/dev` 2.x load through `@pandacss/dev/node`'s `loadConfig` (v1 projects are unchanged). Tested with Panda 1.12.1 and 2.4.0.

# 0.5.0

Panda v2 design-system spec support. On v2, generated tokens now come from the compiler's spec (Panda's own resolution, including derived tokens such as negative spacing), falling back to `loadConfig`. A spec file (`panda codegen --spec cerberus.tokens.json`) is also accepted as an index. Themed aliases resolve through the theme's primitives, matching the runtime CSS variables rather than the spec's base-resolved flat values. Spec `deprecatedReason` is shown as the deprecation message.

Also: CSS variable names in hovers and a **Copy CSS Variable** command; the defining preset or config file in hovers (v2); warnings for deprecated tokens in open editors (`cerberus.deprecations`); recipe variant completions and hovers for recipe components (`<Button palette="…">`) and `styled-system/recipes` calls. CSS variables and recipes also come from v1 configs.

# 0.5.2

Publisher set up for the Visual Studio Marketplace (`ConnorSmith`). Dependencies are pinned to exact versions.
