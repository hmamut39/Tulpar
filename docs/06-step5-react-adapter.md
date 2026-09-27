# Step 5: second adapter (React) — results (2026-09-27)

Goal: add a React adapter for Carbon React, against the same Figma file, and prove the architecture holds. **Gate: zero changes to the core.**

## Gate: passed

```
$ git diff --stat be19cd1 -- core cli/src     # be19cd1 = end of step 4
(no output)
```

Not one line of `core/` changed. The CLI (`cli/src/`) didn't change either. The React adapter plugs into the same protocol, and the same matcher, verifier and report code run on it unchanged.

## What was built

- **`adapters/web-kit`** (a refactor, committed separately in `e2ed44e`): code that belongs to *rendering in a browser*, not to any one framework.
  - It holds: CSS classification, Chromium rendering with DevTools style provenance, esbuild bundling, the harness page, CSS-variable tokens, TypeScript type shapes and Code Connect parsing.
  - The renderer takes two **framework hooks**: `settle` (wait until the framework is done) and `identify` (which component each element is).
  - The Web Components adapter now uses it; all its tests and the mutation suite pass unchanged.
- **`adapters/react`**: about 450 lines.
  - **Index:** the TypeScript checker reads `@carbon/react`'s exports.
    - A component is an exported value callable (or constructible) with one props object that returns an element.
    - Props that React's types or TypeScript's DOM library declare are counted and omitted; that's 40,031 of them, about 156 per component.
    - `children` is the default slot. Props typed as a React node or component are named slots. `on…` function props are events. `as`, `ref` and `key` are kept, marked internal.
  - **Links:** Code Connect's `figma.connect(Component, url, …)`, plus template headers.
  - **Build:** mounts the implementation's default export with `react-dom/client`, compiled by esbuild. CSS the implementation imports is marked as its own.
  - **Identify:** walks React's fiber tree up from each tagged element, through every component that received the same `data-figma-id`. The outermost *design-system* component in that chain is the one the code used.
  - **Static scan:** reads `style={{…}}` objects from the TSX syntax tree (including React's number → `px` rule) and scans imported `.css` files.
- **`examples/carbon-react`**, pinned: `@carbon/react` 1.117.0, React 19.2.0, and the same Carbon styles and fonts as the Web Components example.

## Results

**Index of Carbon React** (`tulpar index examples/carbon-react`):

| | Carbon React | Carbon Web Components (step 2) |
|---|---|---|
| Components | 256 | 290 |
| Design-facing props | 1,750 (98.8% typed by the checker) | 2,658 |
| Enums with values | 190 | 311 |
| Slots | 439 | 426 |
| Events | 202 | 304 |
| Tokens | 356, same DTCG source | 356 |

**Verification of the same Figma frame** (`3906:50588`, the modal footer), written in React ([impl/modal-footer.tsx](../examples/carbon-react/impl/modal-footer.tsx)): the same result as the Web Components version. Every check that ran passed (3 of 3 design-system components, no hard-coded values, layout within ±1 on 3 elements, text exact, typeface as designed). Pixel comparison and interaction states are not checked, so the verdict is **incomplete**.

**Mutation tests, React** ([cli/test/verify.react.mutations.test.ts](../cli/test/verify.react.mutations.test.ts)): **8 of 8 caught**, each by the intended check:

| Mutation | Caught by |
|---|---|
| `style={{ backgroundColor: "#0f62fe" }}` | colours |
| `<button>` instead of `<Button>` | components ("invented") |
| **A look-alike `Button` defined locally, borrowing Carbon's CSS classes** (`cds--btn cds--btn--primary`) | components ("invented"). It *looks* right, but it isn't the design-system component: a common AI-codegen failure. |
| 8 pt shift with a spacing token | layout alone (colours and spacing correctly pass) |
| label "Buton" | text |
| `<Tag>` where a button belongs | components ("another design-system component") |
| `style={{ fontSize: 16 }}` (React adds `px`) | type styles |
| misspelt import `Buton` | build fails. Render, components, layout and text are reported *not checked*, never passed. |

**Matcher on React labels** (`tulpar match examples/carbon-react --evaluate`), unchanged code:

| | Result |
|---|---|
| Links read | 173, from 88 of 89 files. The 89th is commented out in Carbon's repo, so no link is correct. |
| Labelled components usable | 13 (the other 148 links point at uncached Figma pages) |
| Top-1, prior weights | 77% |
| Proposed matches correct | 9 of 10 |

- The one wrong proposal is a real ambiguity: Carbon React has both `Modal` and `ComposedModal`, and Carbon's own mapping chose `ComposedModal`.
- The only label outside the development set is step 0's hard case, "Screen" ↔ `Grid`. The matcher correctly **abstained** rather than guess.
- Same caveat as step 3: too few labels to measure anything. The October run scores both adapters.

## Problems found and solved (adapter-side only)

1. **Polymorphic components were invisible.** `Button` and `Tag` are typed `<T extends ElementType>(props: ButtonProps<T>) => ReactElement | any`, and `ReactElement | any` collapses to `any`. The adapter now accepts an `any` return when the parameter is a real props object.
2. **A union of prop shapes lost most of its props.** The checker returns only the properties all members share. The adapter takes every member's props (Tag's plain, dismissible and selectable forms).
3. **Some components' props flatten to an index signature.** In `Omit<PolymorphicProps<ElementType<any>, OwnProps>, "ref">`, nothing named survives. The adapter recovers `OwnProps` from the type arguments. The first attempt also pulled in the DOM's `HTMLElement` interface via `RefAttributes<HTMLDivElement>`; declarations from TypeScript's own libraries now count as inherited. Ten components use this path, marked medium confidence and counted in the gaps.
4. **Runtime component names can't be trusted.** Carbon's build renames `ModalFooter`'s function to `ModalFooter2` and sets no `displayName`, so the first render identified the footer as `ButtonSet`, which is a component it renders internally. The build now exposes the package's real exports to the page, and components are identified by **identity** (`fiber.type === exports.ModalFooter`), not by name.

None of these needed a core change. Each was a fact about reading React, and it stayed inside the React adapter.

## What the gate does and doesn't prove

- **It proves** that a second framework, one with no custom elements, no registration, JSX, polymorphic typing and a virtual DOM, fits the protocol and the core's model without special cases.
- **It doesn't prove** a *non-web* target. Both adapters render in Chromium and share `web-kit`. The plan's next adapter, **Jetpack Compose** (Kotlin, rendered on the JVM with Paparazzi or Roborazzi), is the real test of the model's "no platform concepts" rule. If the core needs a change for Compose, that's a bug in the core model, to be fixed once for everyone.

## Tests

118 pass. New in this step:
- React Code Connect parsing, including commented-out calls;
- the TSX static scan;
- the Carbon React index (polymorphic components, union props, recovered type-argument props, internal plumbing);
- 9 end-to-end React verification runs.
