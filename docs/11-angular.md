# G6: Angular — results (2026-09-27)

Tulpar now reads, generates and verifies **Angular**, with the file set Angular teams use:

```
modal-actions.component.ts     the standalone component class
modal-actions.component.html   the template
modal-actions.component.less   its own styles
modal-actions.component.spec.ts TestBed tests
```

The design system is **Carbon for Angular** (`carbon-components-angular` 5.72.2, maintained by IBM), against the same Figma kit as the Web Components and React examples. The project is [examples/carbon-angular](../examples/carbon-angular), with Angular 22.2 pinned.

```sh
npm run tulpar -- generate examples/carbon-angular --figma "<frame link>" --name ModalActions
npm run tulpar -- verify examples/carbon-angular impl/modal-actions/modal-actions.component.ts --frame 3906:50588
```

The web page lists it automatically ("Angular · carbon-components-angular@5.72.2").

## What the adapter does

| Part | How |
|---|---|
| **Index** | Compiled Angular libraries declare each component's API in a static field (`static ɵcmp: ɵɵComponentDeclaration<Class, Selector, ExportAs, Inputs, Outputs, Queries, NgContent…>`, or `ɵdir` for directives). The adapter reads the selector, inputs with their template aliases, outputs and content slots, and resolves input types with the TypeScript checker. **180 components and directives in 1.9 s.** |
| **Directives** | Carbon's Angular Button is an attribute directive (`<button cdsButton="primary">`), not an element. The index records how markup writes each component (`markup`), and never guesses the host element of an attribute directive. |
| **Build** | esbuild in **JIT mode** (Angular's runtime compiler), so no Angular CLI is needed. A small plugin inlines `templateUrl` and compiles `.less` with the official `less` compiler. The compiled styles become the implementation's own stylesheet, with `:host` rewritten to the component's element, so the token checks see them. |
| **Render and identify** | The component is bootstrapped standalone with zone.js change detection; the render waits until Angular reports it is stable. Angular's development-mode `ng.getComponent` / `ng.getDirectives` show what sits on each tagged element, matched to the package's exports **by identity**. A `<button>` without `cdsButton` is invented; `<cds-modal-footer>` without its module is "never loaded". |
| **Static scan** | Template `style="…"` and `[style.x]` bindings, plus the **compiled** LESS. A LESS variable (`@gap: 24px`) would otherwise hide a literal. |
| **Mapping** | There are no Code Connect files for Carbon Angular, so no explicit links. The matcher's proposals are the mapping (it found `ModalFooter` and `Button` for the test frame), and **every report says the mapping is unconfirmed**. |

## Findings

- **Carbon for Angular 5.72.2 (August 2026) is still compiled with Angular 14.3**, as NgModules. Angular 22 in JIT mode links these declarations at runtime without complaint. The first spike rendered the modal footer pixel-for-pixel like Web Components and React (320×64 buttons at x = 0 and 320).
- The library's all-in-one import pulls in `@angular/forms` and `@angular/router`, so the example includes them, as real Angular apps do.

## Results

- **Hand-written reference:** every check that runs passes (3 of 3 design-system components, no hard-coded values, layout within ±1, text exact, typeface as designed). Verdict *incomplete* (pixels and states), plus the unconfirmed-mapping warning.
- **Mutation tests, 7 of 7 caught:**
  - hard-coded hex in the template;
  - a plain `<button>` without the directive (invented);
  - **a literal hidden in a LESS variable**;
  - an 8 pt shift made with a token (layout alone);
  - wrong label;
  - **the modal module not imported** (never loaded);
  - an invented token.
- **Real model (`gpt-6-astra`): passed on the first attempt,** with idiomatic Angular:
  - a standalone component with `OnPush` that imports `ButtonModule` and `ModalModule`;
  - `<button type="button" cdsButton="secondary" size="xl">` in the template;
  - LESS for its own layout only;
  - a TestBed spec that checks the Carbon directives with `By.directive`.

## Proof of the architecture

The core changed only by *additions* that any stack benefits from:
- a `{kebab}` file-name placeholder;
- `markup` on code components;
- the unconfirmed-mapping fallback in the CLI pipeline.

Nothing in the matcher, the verifier's checks or the design model had to change for Angular.

152 tests pass.
