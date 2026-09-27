# Product plan: from proof to product (2026-09-27)

Steps 0–6 proved the engine:
- reading a design system in any framework, through adapters;
- mapping Figma to it, with honest confidence;
- verifying rendered UI against the design;
- tracking drift across releases.

This plan builds the product the engine exists for.

## The product

A front-end developer receives a new design with each release: a **Figma link**, or a **screenshot or image** of the UI. In Tulpar they:

1. **Paste the Figma link or upload the image,** and pick their project (design system + framework).
2. **Get the complete component** — every file the feature needs, in their framework:
   - React: `Feature.tsx`, `Feature.css`, `Feature.test.tsx`
   - Angular: `feature.component.ts`, `.html`, `.less`, `.spec.ts`
   - later: any stack with an adapter.
   
   The code uses **their design system's components and tokens**, never hand-made copies.
3. **See the verification report:**
   - built and rendered;
   - design-system components used vs invented;
   - tokens vs hard-coded values;
   - layout, text and typeface compared with the design;
   - honest "not checked" items.
   
   If a check fails, Tulpar repairs the code and verifies again, up to a limit, and says so if it gives up.
4. **Take the code:** download a zip, copy the files, or insert them into VS Code / any IDE.

## Decisions (2026-09-27)

| Question | Decision |
|---|---|
| First generator | React (the adapter exists), then Angular |
| AI model | OpenAI, with the owner's API key (`OPENAI_API_KEY`, never in the repo). Model configurable; default `gpt-6-astra` per OpenAI's current guidance for new projects |
| Web app | Hosted from the start |

## Two ways in, one engine

The **command line** (`tulpar generate`, `verify`, `match`, `drift`) and the **web page** call the same engine. Anything that works in one works in the other. Later, the **IDE** (a VS Code extension, and an MCP server for AI agents) is a third way in, on the same engine.

## Roadmap

Nothing from steps 0–6 is replaced. Each phase adds to what exists.

| # | Phase | What it adds | Status |
|---|---|---|---|
| 0–6 | **Engine** | Figma design model; component index for any framework (adapters); matcher; verifier; drift | ✅ Done (docs 01–07) |
| G1 | **Generation (React)** | Brief (design + mapping + tokens + the framework's file conventions) → OpenAI → files → verify → repair loop. `tulpar generate` | ✅ Done. Real runs with `gpt-6-astra` pass on the first attempt for React and Web Components (docs/10) |
| G2 | **Web page v1** | Paste a Figma URL or upload a screenshot; pick the project (design system + framework); watch progress live; see the files, the rendered result and the report; download a zip | ✅ v1 done (docs/09): Figma link + optional screenshot, files, render, checks, zip. `npm run web` |
| G3 | **Live Figma URLs** | Paste *any* Figma frame link. Tulpar reads the file key and node id and fetches it with the **user's own** Figma token (cached, never re-fetched) | ✅ Done, in the page and in `tulpar generate --figma <link>`. Frames from other files are mapped by component keys |
| G4 | **Hosting** | Deploy the web page as a container. Sign-in or invite codes, per-user limits and a monthly spending cap on the OpenAI key | 🟡 Prepared: Dockerfile, access code, per-visitor limits. Needs a hosting account from you, and a first real deploy |
| G5 | **Screenshot input** | OpenAI vision turns an image into the same design model, recognising design-system components. Results are marked lower confidence than Figma | ✅ Done (docs/09): a screenshot alone works, in the page and in `tulpar generate --image`; the screenshot enables the pixel comparison |
| G6 | **Angular** | Adapter + generator: `.component.ts`, `.html`, `.less`, `.spec.ts` | ✅ Done (docs/11): Carbon for Angular; index, JIT build, render, verify; real model passes on attempt 1 |
| G7 | **Run the generated tests** | Execute `.test.tsx` / `.spec.ts` in a sandbox and add the result to the report (today: delivered, marked "not run") | ✅ Done (docs/12): Vitest browser mode in Chromium, network locked; React and Angular; failures go back for repair |
| G8 | **IDE** | VS Code extension (generate from a Figma link; files land in the workspace) and an MCP server (Cursor, Claude Code, Copilot) | ✅ Done (docs/13): MCP server (Claude Code, Cursor, VS Code/Copilot) and a VS Code extension (.vsix) |
| G9 | **Your own design system** | Index a team's own repository, from GitHub or locally in the IDE, instead of only the built-in Carbon examples | With G8 |
| G10 | **More stacks** | Vue, Svelte, plain HTML/CSS; then non-JavaScript UI stacks: Flutter (Dart), Jetpack Compose (Kotlin), SwiftUI, Blazor (C#), and Python and Java UI frameworks. One adapter each; the core doesn't change (proven in step 5) | Ongoing, one stack at a time |
| G11 | **Pixel comparison and token identity** | Compare the render with Figma's image of the frame; check the *right* token is used, not just *a* token | When the Figma budget allows |
| G12 | **Reports and project page** | HTML report pages; a public page with the proof results | With G4 |
| — | **Matcher scored run** | Fetch the 40 missing Figma pages; measure precision on about 78 held-out Carbon labels (docs/04) | October (Figma budget reset) |

### About "every language"

Tulpar generates **user interfaces**, so each language arrives through its UI frameworks: TypeScript and JavaScript (React, Angular, Vue, Svelte), Dart (Flutter), Kotlin (Compose), Swift (SwiftUI), C# (Blazor, XAML), and Python and Java through the UI frameworks teams use there. **Back-end code** (APIs, services), which the owner asked about earlier, is a separate kind of generation. It needs its own verification (contract tests instead of rendering), so it is planned as its own module after the UI flow is solid.

## Ideas from the owner

_Add ideas here, and they'll be folded into the roadmap._

-


## Hard parts, stated up front

- **A hosted app spends the owner's money.** Every generation is an OpenAI call, and repairs add more. The app needs sign-in or invite codes, per-user limits and a spending cap before it is public.
- **Company confidentiality.** Teams at large companies usually may not send internal designs or code to a third-party website. The hosted app serves public and personal use; companies need the local or self-hosted mode (the same app, run inside their network) and the IDE extension.
- **Running generated code safely on a server.** It is bundled without being executed, then rendered only inside headless Chromium with the network blocked. Generated tests are delivered, and marked "not run" until a sandboxed test runner exists. The server never executes generated Node code.
- **Screenshots carry far less than Figma:** no component names, tokens or exact layers. Recognition relies on the vision model, and verification falls back to pixel comparison. The report must say so.
- **The user's own design system.** The hosted app starts with the design systems it knows (Carbon Web Components and Carbon React). Indexing a user's private repository is the self-hosted or IDE mode's job.
- **Figma access.** Each user connects their own Figma (a personal access token at first, OAuth later). The owner's free-plan API budget cannot serve other people.
