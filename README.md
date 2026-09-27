# Tulpar

**Figma → your design system, verified.**

*Tulpar (تۇلپار) is the winged horse of Turkic legend.*

Tulpar maps the components in a Figma library to the real components in your repository, and keeps that mapping correct as both sides change. It then checks any generated UI against the Figma frame and reports what it found, whether the code came from Figma's MCP server, Cursor, Claude Code or anything else.

> **Try it:** `cp .env.example .env` (add your OpenAI key), `npm install`, `npm run web`, then open http://localhost:4173 ([docs/09](docs/09-web-page.md)).
>
> **Status: early build.** Done so far: step 1, the Figma design model ([docs/02](docs/02-step1-design-model.md)), step 2, the component index and tokens from the Web Components adapter ([docs/03](docs/03-step2-index-and-tokens.md)), step 3, the matcher, built but not yet scored ([docs/04](docs/04-step3-matcher.md)), step 4, the verifier, which catches 7 of 7 injected defects ([docs/05](docs/05-step4-verifier.md)), step 5, a React adapter added with zero core changes ([docs/06](docs/06-step5-react-adapter.md)), and step 6, drift across real releases ([docs/07](docs/07-step6-drift.md)).
> The plan is in [docs/00-research-and-plan.md](docs/00-research-and-plan.md).
>
> ```sh
> npm install
> npm test
> FIGMA_TOKEN=… npm run tulpar -- model <fileKey> <nodeId>...
> (cd examples/carbon && npm install && npm run code-connect) && npm run tulpar -- index examples/carbon
> npm run tulpar -- match examples/carbon --evaluate
> npm run tulpar -- verify examples/carbon impl/modal-footer.html --frame 3906:50588
> npm run tulpar -- verify examples/carbon-react impl/modal-footer.tsx --frame 3906:50588
> npm run tulpar -- drift examples/carbon --from 2.39.0 --to 2.64.0
> ```

## The rule

Tulpar never says something is right unless it has checked. Where it cannot check, it says so. A partial result is never reported as a success.

Example report:

```
CheckoutCard
  ✓ built and rendered
  ✓ 6 of 6 design-system components used, 0 invented
  ✓ 0 hard-coded colours, 0 hard-coded type styles
  ✓ layout within tolerance on 41/41 elements
  ✓ text matches exactly
  – hover / pressed states: not checked (no Figma variants for these states)
```

## What it does

1. **Maintained component mapping.**
   - Tulpar reads your repository and your Figma library, then matches them using explicit links, prop shape, variant sets, names and rendered appearance.
   - Every match shows its evidence and an honest confidence tier. Anything below that tier is reported as unmatched rather than guessed.
   - When either side drifts, you get a finding instead of a silent re-match.
   - Confirmed mappings export as standard Figma Code Connect files, so they stay in your repository.
2. **Verification instead of claims.**
   - Tulpar builds and renders the generated component, then compares it with the Figma frame for layout, text, values and pixels.
   - It reports which design-system components were used versus invented, and which values are tokens versus hard-coded.

## Architecture

- **Core.** Framework-free: the design model from Figma, the component index, matching and verification.
- **Adapters.** One per target stack, running as separate programs that talk to the core over a JSON protocol. That lets a SwiftUI adapter be written in Swift and a Rust adapter in Rust without changing the core.
- **Where it runs.** On your own machine and CI: as a CLI, a CI check and an MCP tool your AI agent can call.

**First targets:** Web Components, then React, both proven against [Carbon](https://github.com/carbon-design-system/carbon) and its public Figma kit.

**Later targets:** Compose, then Vue, Svelte, Angular, Flutter, SwiftUI, .NET and Rust.

## License

No license has been chosen yet. Until one is added, all rights are reserved.
