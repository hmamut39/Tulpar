# Step 4: verifier — results (2026-09-27)

Goal: build and render an implementation of a Figma frame, compare it with the frame, and report the truth. Then prove the verifier is honest: **every injected defect must be caught.**

Run it with:

```sh
npm run tulpar -- verify examples/carbon impl/modal-footer.html --frame 3906:50588
```

It spends no Figma API budget: the design is read from the local cache.

## What was built

- **Protocol:** three new adapter methods, whose results are facts in design terms (`fill`, `textColor`, `fontSize`, `gap`, …), never CSS.
  - `build` bundles the implementation.
  - `render` draws it and reports what was drawn.
  - `analyze` scans the code without running it.
- **Web Components adapter** ([adapters/web-components/src/verify](../adapters/web-components/src/verify)):
  - **build:** esbuild bundles the implementation's module scripts. A harness page holds the markup at the frame's exact size, with Carbon's theme stylesheet and IBM Plex Sans from the pinned npm package.
  - **render:** headless Chromium via Playwright.
    - The **network is blocked**, so a render never depends on a CDN. Carbon's stylesheet tries to load Plex from IBM's CDN; the local package supplies it instead.
    - The renderer waits for custom elements to register, for Lit updates to finish, and for fonts to load.
    - For every element tagged `data-figma-id`, it reports:
      - its box, relative to the frame;
      - its visible text;
      - whether the component was actually loaded;
      - **which font drew its text**, from Chrome's per-text-node font report;
      - **style provenance**: which of the implementation's own declarations set each value, and whether through `var(--cds-*)` or a literal. This uses the DevTools Protocol's `CSS.getMatchedStylesForNode`; `getComputedStyle` cannot tell the two apart. Carbon's internal styles are not counted against the implementation.
  - **analyze:** a static scan of every `<style>` block and `style=""` attribute for hard-coded values, with line numbers.
- **Index:** components now record what they extend. `cds-modal-footer-button` extends `cds-button`, so it is accepted wherever a Button is expected (80 components extend another).
- **Core verifier** ([core/src/verify/verify.ts](../core/src/verify/verify.ts)): layered checks, each ending **pass**, **fail** or **not checked** with a reason:

  | Check | Question it answers |
  |---|---|
  | build | Did it build? |
  | render | Did it render? Any warnings? |
  | components | Is each Figma instance the mapped design-system component (or a subclass)? Or is it a *different* design-system component, *invented* from primitives, *never loaded*, or *missing*? |
  | colours | Are colours tokens or hard-coded? From the render and the static scan, counted once each. |
  | type styles | Are type styles tokens or hard-coded? |
  | spacing | Is spacing tokens or hard-coded? |
  | layout | Is each tagged element's box within tolerance (±1 pt for boxes, ±3 for text)? Is anything rendered that the design hides or doesn't have? |
  | text | Does the rendered text match the design exactly (whitespace collapsed)? |
  | typeface | Was the text drawn in the font family the design uses? |
  | pixel comparison | not checked yet (see below) |
  | interaction states | not checked yet (see below) |

  - **The verdict is "pass" only if every check ran and passed.** No failures with some checks unrun is "incomplete". A partial result is never reported as success.
  - The headline is built only from checks that ran.

## Result on the reference implementation

Frame: Figma "_Modal footer item", variant "Actions=2, Cancel=False, Inline loading=False" (`3906:50588`), 640×64. The hand-written reference implementation is in [examples/carbon/impl/modal-footer.html](../examples/carbon/impl/modal-footer.html).

```
✓ built
✓ rendered (chromium 153.0.8010.12)
✓ 3 of 3 design-system components used, 0 invented
✓ 0 hard-coded colours
✓ 0 hard-coded type styles
✓ 0 hard-coded spacing values
✓ layout within tolerance on 3/3 elements
✓ text matches exactly (2)
✓ typeface as designed on 2/2 elements
– Pixel comparison: not checked (no Figma image of the frame (the images endpoint shares the monthly API budget))
– Hover, focus and pressed states: not checked (interaction states are not rendered)
Verdict: INCOMPLETE (no check failed, but not everything could be checked)
```

**Kit vs code, measured:**
- Carbon renders the two buttons at 320 pt each, at x = 0 and x = 320.
- The Figma kit draws them at 319.5 pt, at x = 0 and x = 321, with a 1 pt seam.
- That is within the ±1 tolerance, and the report shows the numbers.

## Mutation tests: every defect caught

[cli/test/verify.mutations.test.ts](../cli/test/verify.mutations.test.ts) makes each mutant from the reference with exactly one defect, runs the full pipeline, and requires the *right* check to fail with the *right* detail:

| Mutation | Caught by | Detail reported |
|---|---|---|
| `background-color: #0f62fe` on a button | colours | `fill: #0f62fe at … style attribute` |
| `<button>` instead of the Carbon button | components | "invented instead of the design-system component" |
| 8 pt shift made with a spacing **token** | layout (colours and spacing correctly pass) | `x 0 → 8 (+8)` |
| label "Buton" | text | `design says "Button", rendered "Buton"` |
| import removed: the tag still matches | components | "was never loaded (missing import?)" |
| `cds-tag` where a button belongs | components | "another design-system component" |
| `font-size: 16px` | type styles | `fontSize: 16px` |

**7 of 7 caught.** Two were wrong on the first run, and both times the *mutant* was at fault, not the verifier:
- `left: var(--cds-spacing-03)` didn't move anything. Carbon's spacing tokens aren't global CSS variables; its own styles always give a fallback. The layout check was right to pass it, so the mutant now uses Carbon's own pattern, `var(--cds-spacing-03, 0.5rem)`.
- The `cds-tag` mutant didn't import the tag. The verifier failed it as "never loaded", correctly but not for the intended reason, so the mutant now imports it.

**Holes found and closed while building:**
- **A tag name matching but never loaded** now fails the components check. Before, a missing import would have passed.
- **`1px` in `border: 1px solid var(--token)`** was counted as a hard-coded colour. Colour checks now count only colour-like literals.
- **The first font check was wrong.** `document.fonts.check()` failed because Carbon's CDN font faces are registered but blocked. It was replaced with the fonts Chrome reports it actually drew with.

## Not done yet (stated, not hidden)

- **Pixel comparison.** Needs a Figma render of the frame from the images endpoint, which shares the exhausted monthly budget. Planned: pixelmatch/SSIM with diff regions attributed to named elements, text interiors down-weighted.
- **Token identity.** The verifier checks *that* a token is used, not that it is the *right* token. Figma gives only variable ids; names need the Enterprise-only Variables API. Next: match Figma's resolved colours against theme token values.
- **Values.** Rendered colours are not yet compared with the Figma fills.
- **Pinned renderer.** This machine has no Docker, so renders use Playwright's Chromium on Windows, and every report names its renderer. The pinned Linux image (`mcr.microsoft.com/playwright:v1.63.0-noble`) belongs in CI.
- **Frames.** One frame so far, hand-implemented. The plan's other two (a card with tags, a modal with a data list) are larger and follow the same path.
- **Generation.** The plan had a thin LLM call generate each frame's code. The reference here is hand-written on purpose: a known-good baseline is what makes mutation testing meaningful, and generation isn't the product. Scoring real AI output (Figma MCP, Cursor, Claude Code) against the same frames is the natural next use.

## Tests

101 pass:
- the verifier's verdict logic, including "not checked" for everything a failed build or a missing capability prevents;
- style classification;
- the 8 end-to-end runs on Carbon: the reference plus 7 mutants.
