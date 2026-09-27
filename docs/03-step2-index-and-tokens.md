# Step 2: component index + tokens — results (2026-09-27)

Goal: the first adapter (Web Components) reads a real design system's components and tokens, and the core measures how complete and trustworthy that reading is.

Target: Carbon, pinned in [examples/carbon](../examples/carbon):
- `@carbon/web-components` 2.64.0
- `@carbon/themes` 11.82.0
- `@carbon/layout` 11.60.0

Run it with `npm run tulpar -- index examples/carbon`. It uses no Figma API calls.

## What was built

- **Adapter protocol** ([core/src/adapter](../core/src/adapter)): JSON-RPC 2.0 over stdio, one message per line.
  - The core starts the adapter as a child process and never imports it.
  - The adapter declares its capabilities up front. Anything it can't do yet (emit, build, render) is declared `false`, so the core can say "not checked".
- **Code model** ([core/src/code-model.ts](../core/src/code-model.ts)): components, props, slots, events and tokens.
  - Every fact carries its **provenance**: which reader produced it, and with what confidence.
  - Anything that couldn't be read is listed in `gaps`.
- **DTCG reader** in the core ([core/src/tokens/dtcg.ts](../core/src/tokens/dtcg.ts)):
  - resolves aliases per mode and across files;
  - parses DTCG 2025.10 colours and dimensions;
  - reports departures from the spec instead of silently accepting them.
- **Web Components adapter** ([adapters/web-components](../adapters/web-components)) reads in tiers, as the plan proposed:
  1. **Tier 0 — the package's manifest**: names, attributes, defaults, descriptions and events.
  2. **Tier 1 — the package's `.d.ts` files, through the TypeScript checker**: resolved types, enum values, static members and read-only getters.
  3. **Heuristic — a scan of the compiled templates for `<slot>` tags**: fills in the slots the manifest misses.
  4. **Tokens** come from Carbon's DTCG files. Each token's CSS custom property is checked against the stylesheets the components actually ship.
- **Coverage report** ([core/src/coverage.ts](../core/src/coverage.ts)): computed by the core, not the adapter.

## Results on Carbon

| | Result |
|---|---|
| Components | 290 (10 deprecated, 283 with a description) |
| Props | 3,305 in total. 2,658 face the design; 647 are internal runtime API (e.g. Lit's static `styles`, form getters) and are marked with the reason, not deleted. |
| Prop types | 2,475 resolved by the TypeScript checker, 47 from the manifest only. 136 are declared `any` in Carbon's own `.d.ts` files and are reported as "no type", not guessed. |
| Enums with values | **311** (300 closed, 11 open, such as `size: BUTTON_SIZE \| string`). The manifest alone gave 24. |
| Slots | 426: 287 found only by the template scan, 74 only in the manifest, 65 in both. 88 components have no slots. |
| Events | 304 |
| Tokens | 356 (312 colour, 44 dimension) across the 4 themes: white, g10, g90, g100 |
| Unresolved token values | 3 (viewport-relative fluid spacing such as `5vw`) |
| Token code names not seen in any component stylesheet | 28 (container, size, icon-size, border-radius and layout tokens), reported as unconfirmed |

## What we learned

1. **The manifest alone would have crippled the matcher.** Carbon ships the deprecated WCA manifest format, not the standard Custom Elements Manifest (CEM). Carbon plans to switch in v3 ([carbon#20670](https://github.com/carbon-design-system/carbon/issues/20670)). In the manifest:
   - enum types are bare names (`kind: BUTTON_KIND`), with no values;
   - 255 enum-typed props could not be expanded;
   - only 131 slots are listed.

   The TypeScript tier raises enums with values from 24 to 311, and the template scan roughly triples the slot count. This is the plan's "tiered reader" decision, now shown on real data.
2. **TypeScript 7 (the Go port) has no stable compiler API.** The adapter pins TypeScript 6.0 for its checker; the repository itself uses TypeScript 7.
   - Carbon's `.d.ts` files use extensionless imports, so the checker must use `Bundler` module resolution. With `NodeNext`, half of the props silently resolved to `any`. The coverage report caught this.
3. **The TypeScript checker merges `BUTTON_SIZE | string` into plain `string`**, which throws away the six known sizes. The adapter resolves each member of the declared union separately and reports an *open* enum.
4. **Carbon's DTCG files depart from the spec in two ways, both reported as gaps:**
   - some tokens also contain child tokens (e.g. `background` and `background.hover`);
   - per-theme values sit in `$extensions["carbon.themes"]` instead of `$value`.

   Layout tokens also store bare numbers with a Carbon-specific converter: × 8 px for "mini units", or px shown as rem.
5. **Bugs found by the tests, not by inspection:**
   - `shutdown` killed requests that were still in flight;
   - calls made after `stop()` hung forever.

   Both are fixed.

## Not done yet (stated, not hidden)

- **Type tokens** (`@carbon/type`) are not read yet: Carbon ships no DTCG file for them. Figma text styles therefore have nothing on the code side to link to yet.
- **Figma variable ids → token names.** Variable names need the Enterprise-only Variables API. The planned workaround matches the values Figma reports against theme token values; the same variable id always maps to the same token, so candidates narrow across uses. This is a step 4 dependency.
- **Standard CEM manifests** are detected and reported as unread. Carbon doesn't use CEM yet.
- **The slot scan is a regex over template text**, marked medium confidence. tree-sitter's HTML-in-JS injection is the planned replacement.

## Tests

63 tests pass (`npm test`), including:
- DTCG behaviour: aliases per mode, alpha modifiers, cycles, units, mode filtering, and the reported gaps;
- the adapter on a fixture package, over the real stdio protocol;
- checks against the installed Carbon packages: `cds-button`'s 8 kinds, its open size enum and its 3 slots; `background` and `spacing-05` values.

## Next

**Step 3: the matcher, scored** against Carbon's Code Connect files with those files hidden. It needs:
- the component sets on the 40 Figma pages not yet cached. Figma's budget resets in October; one or two requests will fetch them all.
- Carbon's Code Connect files from the git repository, fetched with a sparse clone. This needs no Figma calls.

The matching features can be built now against the 14 pages already cached.
