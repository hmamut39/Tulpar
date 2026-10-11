# Your own design system (G9)

Until now every example was Carbon, and parts of Tulpar assumed it. This step lets a team
point Tulpar at its own library in one command, and tests that on a design system Tulpar
was not built around: Shoelace (`examples/shoelace`, set up only by `tulpar init`).

## `tulpar init`

```sh
cd my-app
npx tulpar init --figma "https://www.figma.com/design/<file>/…"
```

It reads `package.json` and `node_modules` and finds the following, printing its evidence for each guess:

| Finds | How |
|---|---|
| Framework | `@angular/core` → Angular; `react` → React; otherwise Web Components. `--adapter` overrides it. |
| Design-system package | The dependency that looks most like one: a custom elements manifest, "design system / components / ui" in its description or keywords, a framework peer dependency, shipped CSS and types. Build tools and utilities are never picked. `--package` overrides it. |
| Tokens | DTCG files (`*.tokens.json`, or JSON with `$value` under a `tokens/` folder), and stylesheets that declare 20 or more custom properties on `:root` or a theme selector. It searches the package and sibling packages such as `@acme/tokens` or `@acme/themes`. It finds the shared prefix (`--sl-`), and the theme selectors become modes, with the one declared with `:root` first. Copies under `cdn/` are skipped when `dist/` has the same file. |
| Stylesheets to render with | The token sheets plus the package's main stylesheet. |
| Code Connect | `*.figma.tsx`/`*.ts` files in the project itself. |

It then writes `tulpar.json` and runs the adapter, printing the number of components, tokens and links, and any gaps.

## What had to change in Tulpar

Running it on Shoelace showed what was still Carbon-only:

1. **Tokens as CSS custom properties** (`web-kit/src/css-tokens.ts`). Shoelace, like many libraries, publishes no DTCG files.
   - Each `--sl-*` property on `:root`/`:host`/`html` or on a theme selector becomes a token.
   - Values are resolved through `var()` per mode: hex, `rgb()`/`hsl()`, px/rem, numbers. Anything else (shadows, font stacks) is kept "unresolved", never guessed.
   - A theme block that also names `:host` (for shadow roots) sets that theme, not the default.
   - Result on Shoelace: 390 tokens (288 colours, 57 lengths), in modes default, light and dark.
2. **The standard Custom Elements Manifest** (CEM 1.x). Before, only Carbon's older WCA format was read.
   - Public fields become props, with their attributes.
   - Private, static and `_`-prefixed members are not props.
   - Class lookup in `.d.ts` files now follows re-exports (`button.d.ts` → `button.component.d.ts`).
   - Result on Shoelace: 58 components, 490 props, 107 slots, 113 events.
3. **Coding rules that came from Carbon.** The Web Components adapter told the model to import `…/es/components/button/index.js` and gave `--cds-` token examples. The import example and token prefix now come from the project. The first three Shoelace runs failed to build for this reason alone.
4. **The checker read only light-DOM text and block boxes.** Shoelace draws labels and placeholders inside shadow roots.
   - The renderer now walks the composed tree (shadow roots and slots, including `display: contents` slots, which the browser's visibility test calls hidden).
   - It reads input placeholders and values.
   - It records a **drawn box**: the extent of text and of elements that paint something.
   - Layout passes when the element's box or its drawn box matches the design. A full-width checkbox host that draws a 16 px box and a label is then judged by what it draws. The Carbon mutation tests (deliberately broken components) still fail as they should.
5. **The model gamed a check once.** When the checker could not see a real placeholder, the model faked one: placeholder text in a slot, hidden with script.
   - Fixing the checker removed the reason.
   - A new rule says to express a label as a label and a placeholder as a placeholder, and to pick tokens by meaning as well as value. An earlier attempt used a font-size token for padding.
   - Generation now saves every attempt's failures (`history` in `tulpar-report.json`), which is how both problems were found.

## Result

A sign-in card drawn as a plain HTML mockup was given to Tulpar as a screenshot. Tulpar wrote it with Shoelace in 3 attempts:

| Check | Result |
|---|---|
| Built, rendered | ✓ |
| Design-system components | ✓ 5 of 5 (`sl-card`, `sl-input` ×2, `sl-checkbox`, `sl-button`), 0 invented |
| Colours, type, spacing | ✓ 0 hard-coded values; tokens chosen by meaning |
| Layout | ✓ 8 of 8 within the screenshot tolerance |
| Text | ✓ 6 of 6, including labels and placeholders inside the inputs |
| Pixels | ✓ 6.3% differ (limit 8%) |
| Typeface, tests, states | not checked (the screenshot names no font; the Web Components adapter has no test runner yet) |

The code uses the components' own API (`label`, `placeholder`, `variant="primary"`) and no script.

**Still open:**
- **Fonts.** Light-DOM text renders in the browser's default font. Shoelace expects the app to set `font-family: var(--sl-font-sans)`, and screenshot designs name no font. Next: the screenshot reader estimates the font class, and `init` records the design system's base font token so the render uses it.
- **Token kind check.** Flag a token of the wrong kind (a font-size token used as padding) in the verifier, not only in the prompt.
- **More libraries.** Run `init` on React and Angular libraries other than Carbon, for example MUI, Chakra, Radix Themes and PrimeNG.

## Radix Themes (React), 2026-10-10

The second library. `tulpar init` found it with no hand edits after these fixes:
- **Themes vs scope classes.** A theme is a selector that redefines most of the default tokens (`.dark` redefines `:root, .light`). Accent colours and radius variants are not themes. Theme names drop filler words (`.light-theme` → light).
- **Root class.** `.radix-themes` declares its own tokens; Radix's `<Theme>` adds it. It becomes `render.rootClass`, applied to the frame, and the page font is set on the frame too.
- **Declared stylesheet.** The package's `style` field (`styles.css`) wins. Source copies under `src/` are ignored, and a sheet whose (theme, token) pairs are already covered is dropped. Theme sheets that repeat names, like Shoelace's light/dark, are kept.
- **Missing `@types/react`.** `init` now says so, because without it no props can be read.

Then the React adapter, for compound-component libraries generally:
- **Namespace members and statics are components.** `TextField.Root`, `Dialog.Content`, `Menu.Item`: 134 components instead of 45. The runtime identifies them by identity too.
- **Identity walks over wrappers.** The walk steps past a few components that don't carry the id (Radix's Checkbox passes through a context provider). Before, the checkbox was reported as its internal `CheckboxTrigger`.
- **One element per id.** When a hidden input copies a component's attributes, the visible element stands for it.
- **Package CSS stays the design system's.** `import "@radix-ui/themes/styles.css"` used to be folded into the component's own CSS, and every value inside Radix was blamed on it. The bundler now loads package CSS as a page stylesheet.

And two checker rules that came from reading the code, not the check results:
- **Measured layouts in disguise.** `grid-template-columns: minmax(0, 25fr) minmax(0, 310fr) …` copies pixel measurements as ratios. Grid tracks are now size values: fixed lengths and `fr` values above 12 or fractional are hard-coded. Normal grids (`repeat(3, 1fr)`, `1fr auto`) are fine.
- **Colour feedback on pixel differences.** Each differing region now names its most common colour in the design and the render ("mostly #0284c7 in the design, #3e63dd in the render"). With this, the repair moved the button to a matching accent colour within the attempt budget.

**Result:** the same sign-in screenshot, in React with Radix Themes.

| Check | Result |
|---|---|
| Components | 6 of 6 (`Card`, `Heading`, `Text`, `TextField.Root` ×2, `Checkbox`, `Button`), 0 invented |
| Colours, type, spacing | 0 hard-coded values, no measured grid |
| Layout, text, typeface | 11/11, 8/8, 8/8 |
| Pixels | 5.9% differ (limit 8%) |

The code uses Radix's own API (`<Theme accentColor>`, `size`, `variant`, `TextField.Root` with `placeholder`), with labels tied to inputs.

## MUI (React): tokens that exist only at runtime, 2026-10-10

MUI, Chakra and PrimeNG build their theme in JavaScript when their provider starts. No file holds the tokens, and components are unstyled without the provider.

- **Setup file** (`render.setup`). A project file that sets the app up as the design system needs: for React a wrapper component (MUI's `ThemeProvider`), for Angular a module exporting `providers`. The render wraps the implementation in it.
- **Runtime tokens** (`tokens.runtime`). The adapter builds a probe page (an empty component, with the setup applied) and reads every custom property with the prefix declared on `:root`, `html`, `:host` or the root class. It uses computed values, then reads them again with each dark-mode class applied. On MUI: 203 tokens, light and dark. `--mui-palette-primary-main` is `#1976d2` in light and `#90caf9` in dark.
- **Recipes in `tulpar init`.** For MUI, Chakra and PrimeNG, `init` writes the setup file with the library's default theme (a comment says to point it at the team's own) and turns on runtime tokens with the library's prefix and dark-mode class.
- **Scale units.** MUI's `--mui-spacing` is a unit (8px) meant to be multiplied (`theme.spacing(3)`). Whole multiples of a token named as a unit (`-spacing`, `-unit`, with no step) are now tokens. Other arithmetic on tokens is still hard-coded.
- **Invisible characters.** MUI's outlined input draws a zero-width space. It is stripped from rendered text, and an input's placeholder is read in light DOM as well as shadow DOM.

**Result (MUI, same screenshot):** 9/9 components, 0 hard-coded values (spacing written as `calc(var(--mui-spacing) * 3)`), layout 10/10, text 8/8, 7.0% pixel difference.

## Chakra UI v3 (React): indexed, not yet passing, 2026-10-10

- **Index.** Chakra components accept every CSS property as a style prop, and the index grew past Node's string limit. Props declared once and shared by 40% or more of components are now treated as a style system and omitted, like React's DOM attributes: 441,082 occurrences, counted in a gap note. Very long type texts are capped.
- **Duplicates.** Parts exported twice are listed once. When the same declaration is exported flat and namespaced (`AccordionItem`, `Accordion.Item`), the flat name is kept, because it always imports. A namespaced static that re-exposes a flat export of the same name (Carbon's `DataTable.Table`) is dropped, so Carbon's Code Connect links and matcher accuracy are unchanged (top-1 77%). React context objects (`.Provider`, `.Consumer`) and data classes are not components.
- **Tokens.** Chakra declares its variables under `:where(:root, :host)`, which the probe now unwraps: 493 tokens, light and dark.
- **Result:** 669 components. The sign-in card uses 11/11 Chakra components with 0 hard-coded values and text 8/8, but the pixel check fails (12.6% at best). **Not passing yet.**
- **Best attempt, not last.** The third repair made the Chakra card worse (12.6% → 22.4%). Generation now delivers the attempt with the fewest failing checks (the later one on a tie), with that attempt's own render.

**Still to do:** Chakra fidelity; PrimeNG, which needs the Angular adapter to apply the setup's providers and run the token probe (the recipe in `tulpar init` is ready).

## PrimeNG (Angular): indexed, not yet passing, 2026-10-11

- **Entry points.** PrimeNG publishes each component as its own entry point (`primeng/button`) and nothing at the root. The Angular indexer now reads every subpath in the package's `exports` map and records each component's real import path: 307 components.
- **Signal inputs.** `size = input<"small" | "large">()` is typed `InputSignal<…>`. The value type is unwrapped, as is the accepted type of a transform: 157 props now show their allowed values.
- **Setup and runtime tokens.** The setup's `providers` (`providePrimeNG({ theme: { preset: Aura } })`) go into the bootstrap. Tokens are read from a probe page: 407 `--p-*` tokens, light and dark.
- **Identity.** The render page exposes the entry points the implementation imports. All of them would pull in optional peers such as `primeng/chart` → chart.js.
- **Result:** 4/5 components (the password field used `InputText` instead of `Password`), 0 hard-coded values, layout 11/11, text 8/8, typeface 8/8. Pixels differ by 16.5%, mostly because PrimeNG's default theme (Aura) is emerald and the design is sky blue. **Not passing yet**; with a team's own preset in the setup file the colours would come from their theme.
