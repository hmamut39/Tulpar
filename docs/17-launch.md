# Launch posts

Drafts for Mamuti Aishan (Hasan) to post. The facts in them are true as of 28 Oct 2026: check `tulparsi.com/benchmark` and the pricing page before posting, and change any number that moved.

Facts used:

- Benchmark: 10 cases (React, Vue, Angular, Svelte, Web Components and Flutter; Carbon, Radix, shadcn/ui, Element Plus, PrimeNG, Material 3). 9 verified, all 12 checks passing; Flutter has no failing check, and its widget tests run on the server only.
- Free trial: 20 verified generations, no card. Pro: $29/month, 300 generations.
- Surfaces: web page, CLI, VS Code extension (also Cursor, Windsurf, VSCodium), MCP server, Figma plugin (once published).

---

## Product Hunt

**Name:** Tulpar

**Tagline (60 characters max):** Figma to code in your design system, checked before you see it

**Description (260 characters max):**
Paste a Figma frame or a screenshot. Tulpar writes the component with your team's own design system (Carbon, MUI, shadcn/ui and more), then builds it, renders it and checks it: components, tokens, layout, text, pixels, tests. Failures are repaired or named.

**Topics:** Developer Tools, Design Tools, Artificial Intelligence

**First comment (from the maker):**

> Hi, I'm Hasan. I built Tulpar because AI design-to-code tools give you code that looks like the picture but isn't how your team writes it: a hand-made button instead of your design system's, hex colours instead of your tokens, and no way to know what's wrong until review.
>
> Tulpar does two things differently:
>
> 1. **It writes with your design system.** It reads your component library (its real props) and your tokens, and uses them. React, Vue, Angular, Svelte, Web Components and Flutter, in your language and styling (TypeScript or JavaScript; CSS, SCSS, LESS, Tailwind, CSS Modules, styled-components, Emotion).
> 2. **It checks before you see it.** Every result is built, rendered in a sandboxed browser and compared with the design: the right components, colours and spacing from tokens, layout, text, typeface, the generated tests, pixels, and hover, pressed and focus states. Failures go back to the model to repair. If something still fails or can't be checked, the result says so plainly.
>
> The benchmark is public, failures included: tulparsi.com/benchmark
>
> Then ask for changes in words ("make the button full width"), and they're checked again. It's on the web, in VS Code and Cursor, as an MCP server for AI coding assistants, and as a Figma plugin.
>
> Free trial with no card. I'd love to hear where it gets your design system wrong.

**Gallery (in order):**

1. `figma-plugin/cover-1920x960.png` (frame to verified code).
2. A screenshot of a verified result on tulparsi.com: the checks list and the code.
3. The benchmark page.
4. The Figma plugin panel with a result.
5. VS Code: "Ask for a change".

---

## Show HN

**Title:** Show HN: Tulpar – Figma to code in your design system, verified in a browser

**Text:**

> Tulpar turns a Figma frame or a screenshot into a component written with your team's design system, and then checks it before you see it.
>
> The generation part is a model with a detailed brief: your library's real component APIs (read from its TypeScript types, Vue/Svelte/Angular sources or Dart analyzer output), your tokens, and how your codebase already uses the components. Most of the work is the checking:
>
> - It builds the files and renders them in headless Chromium with the network blocked.
> - It identifies which design-system component each element really is (by identity, not by name), so a hand-made `<button>` fails.
> - It reads the CSS that actually applied and fails hard-coded colours, spacing and type, invented tokens, and tokens of the wrong kind (a border colour used for text).
> - It compares layout boxes, text and the typeface that drew it, and pixels against Figma's own picture of the frame. Kit placeholders and photos are masked; the design's web fonts are fetched for the sandbox.
> - It runs the tests it generated, and checks hover, pressed and focus states with a real mouse and keyboard.
>
> Failures go back to the model, and the best attempt is kept (a repair that makes things worse is set aside). A repair that deletes tests or assertions is rejected. When a design isn't built with the chosen design system, the report says so rather than listing failures with no reason.
>
> The benchmark is public, failures included: https://tulparsi.com/benchmark
>
> Adapters: React, Vue, Angular, Svelte, Web Components, Flutter. Built-in examples: Carbon, MUI, Chakra, Radix, shadcn/ui, PrimeNG, Element Plus, Shoelace and Material 3, or any design system on npm.
>
> Free trial with no card: https://tulparsi.com. I'm the only developer. I'd especially like to hear about design systems it handles badly.

---

## LinkedIn

> I've been building Tulpar: you give it a Figma frame or a screenshot, and it writes the component with your team's own design system. Then it checks the result before you see it.
>
> Most design-to-code AI stops at "looks similar". In a real product that isn't enough. The code has to use your components and your tokens, and it has to match the design.
>
> So every result is built, rendered in a browser and checked:
> ✅ your design system's components, not look-alikes
> ✅ colours, type and spacing from your tokens
> ✅ layout, text and typeface against the design
> ✅ pixels against Figma's own picture
> ✅ its own tests, plus hover, pressed and focus states
>
> If something fails, it's repaired. If it can't be checked, it says so.
>
> The benchmark is public, failures included: tulparsi.com/benchmark
>
> React, Vue, Angular, Svelte, Web Components and Flutter, with Carbon, MUI, shadcn/ui, Radix, PrimeNG, Element Plus and more. On the web, in VS Code, in Figma, and for AI coding assistants through MCP.
>
> Free trial, no card: tulparsi.com
>
> #FrontendDevelopment #DesignSystems #Figma #React #AI

---

## Before posting

- [ ] The Figma plugin is published (or remove it from the posts).
- [ ] VS Code extension 1.4.0 is on the Marketplace (for "Ask for a change" in VS Code).
- [ ] The test Pro subscription is cancelled, and Stripe is in live mode.
- [ ] OpenAI auto-reload is on, with a monthly limit that covers a launch-day spike (about $1.40 per screenshot run, less for Figma frames).
- [ ] `TULPAR_RUNS_PER_DAY` on Fly is set to what the budget allows.
