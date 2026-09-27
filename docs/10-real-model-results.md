# First runs with the real model (2026-09-27)

`OPENAI_API_KEY` is set (restricted key: *List models* read, *Responses* write, 90-day expiry). The key lists 138 models, including `gpt-6-astra`, Tulpar's default.

Every run: the modal footer frame (`3906:50588`) → `tulpar generate` → verified against the Figma frame.

## What happened, run by run

Reading the generated code, not just the checks, turned up problems in **Tulpar**, not only in the model. Each was fixed and is now tested.

| Run | Result | What reading the code showed | Fix |
|---|---|---|---|
| React #1 | Attempt 1 failed (2 hard-coded spacing values); attempt 2 passed | **Faked tokens:** `inline-size: calc(var(--cds-spacing-13, 10rem) * 4)` is "640px" dressed as a token, and it pinned the component to the frame's size. Width and height were never checked at all. | Token arithmetic now counts as hard-coded. Width and height are checked as sizes. The model is told the component fills its container. |
| React #2 | Passed on attempt 1 | **An invented token:** `var(--cds-border-width-01)` exists nowhere, so the gap rendered as 0. The verifier counted it as "a token". | The render asks the browser whether each variable is defined. An unknown token fails ("no such token"). A known token must be defined or carry its fallback. |
| (re-verify) | A theme colour looked undefined | **A harness bug:** Carbon defines theme colours on a theme class (`.cds--white`), and the harness applied no theme unless asked. Every earlier render ran unthemed; components only looked right through their built-in fallbacks. | The harness always applies the project's default theme. |
| React #3, WC #1 | Both passed on attempt 1 | **A brief bug:** the Web Components output put the label in `tooltip-text`. Tulpar's prop matching had paired Figma's "Button text" with `tooltipText` (both contain "text"). | A Figma text property goes to the component's content when it has a default slot. |
| WC #2 | Passed on attempt 1 | Clean: `<cds-button kind="secondary" size="xl">Button</cds-button>` | — |

The brief now also lists the project's **real** spacing and size tokens with their values, and says to write tokens with their fallback, `var(--cds-spacing-05, 1rem)`, the way Carbon's own styles do.

## The final output

React (`out/carbon-react/generated/ModalActions/`):

```tsx
<ModalFooter className="modal-actions" data-figma-id="3906:50588">
  <Button data-figma-id="4122:87677" kind="secondary" size="xl">Button</Button>
  <Button data-figma-id="4122:86445" kind="primary" size="xl">Button</Button>
</ModalFooter>
```

```css
.modal-actions { display: flex; align-items: stretch; gap: 0; background: var(--cds-field-01, #f4f4f4); }
.modal-actions > .modal-actions__button { flex: 1 1 0; min-inline-size: 0; }
```

- Design-system components with the props translated from Figma.
- Tokens with fallbacks.
- A fluid layout.
- Every element tagged.

Verification: every check that runs passes. Pixel comparison and interaction states are honestly *not checked*.

**Cost:** about 1.5k input and 0.6–1.6k output tokens per attempt; a run takes about 30–60 seconds, most of it rendering.

**Still imperfect:** the React CSS has an unused `.modal-actions__separator` rule. No check looks for dead CSS yet.

## New tests

- **React mutants:** an invented token, and a known token without its fallback.
- **Core:** all four token outcomes (defined; known with fallback; known without fallback; invented).
- **Adapter:** classification of sizes and token arithmetic.

135 tests pass.

## What this says about the product

- **The model is good; the guardrails decide the quality.** Every problem above was caught by reading the output, then turned into a check, so the next run can't pass with it.
- **Honesty needs the ground truth.** "Is this a token?" can't be answered from the code alone; the render has to confirm the variable exists. The same will hold for every stack.
