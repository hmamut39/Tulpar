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
| G7 | **Run the generated tests** | Execute `.test.tsx` / `.spec.ts` in a sandbox and add the result to the report (today: delivered, marked "not run") | ✅ Done (docs/12): Vitest browser mode in Chromium, network locked; React, Vue, Angular, Svelte and Web Components (the HTML file imports as a module with `mount()`); failures go back for repair |
| G8 | **IDE** | VS Code extension (generate from a Figma link; files land in the workspace) and an MCP server (Cursor, Claude Code, Copilot) | ✅ Done (docs/13): MCP server (Claude Code, Cursor, VS Code/Copilot) and a VS Code extension (.vsix) |
| G9 | **Your own design system** | Index a team's own repository, from GitHub or locally in the IDE, instead of only the built-in Carbon examples. **Done locally (2026-10-10):** `tulpar init`, CSS-variable tokens and the standard Custom Elements Manifest; first run on Shoelace passes (docs/15). Next: React and Angular libraries other than Carbon, and indexing a repo from GitHub on the web page. | 🔄 In progress |
| G10 | **More stacks** | Vue, Svelte, plain HTML/CSS; then non-JavaScript UI stacks: Flutter (Dart), Jetpack Compose (Kotlin), SwiftUI, Blazor (C#), and Python and Java UI frameworks. One adapter each; the core doesn't change (proven in step 5) | Ongoing, one stack at a time |
| G11 | **Pixel comparison and token identity** | Compare the render with Figma's image of the frame; check the *right* token is used, not just *a* token | When the Figma budget allows |
| G12 | **Reports and project page** | HTML report pages; a public page with the proof results | With G4 |
| — | **Matcher scored run** | 25 of 54 Figma pages read. Held-out top-1: 68% (WC) and 70% (React); the right answer was in the top 3 in 93–100% of cases. The errors were "X item" → X. Fix (2026-10-10): "item" is a part word, not filler. After the fix, top-1 is 86% (WC) and 74% (React), but those labels informed the fix, so they are now dev round 2. An LLM re-ranker of the top 3 (docs/04) raised top-1 to 91% (WC) and 90% (React); all 27 high-confidence picks were right. It now runs in generation for components with no link. Next: read the other 29 pages (Figma budget) as the clean test. | 🔄 In progress |

### About "every language"

Tulpar generates **user interfaces**, so each language arrives through its UI frameworks: TypeScript and JavaScript (React, Angular, Vue, Svelte), Dart (Flutter), Kotlin (Compose), Swift (SwiftUI), C# (Blazor, XAML), and Python and Java through the UI frameworks teams use there. **Back-end code** (APIs, services), which the owner asked about earlier, is a separate kind of generation. It needs its own verification (contract tests instead of rendering), so it is planned as its own module after the UI flow is solid.

## Roadmap v2 (2026-10-10): what makes senior developers and leads adopt it

v1 proved the flow end to end: Figma or a screenshot in, verified code out, in three frameworks, from the web, the CLI and the editor. What senior developers and leads ask next is different, and the plan follows their questions.

| They ask | What we build | Today's tech, used where it really helps |
|---|---|---|
| "Does it work with **our** design system?" | **G9: bring your own design system.** `tulpar init` detects the stack and the component library in a repository and writes `tulpar.json`. Indexing, tokens and mapping then run on the team's own code. | — |
| "Will it write code **the way we do**?" | **Repository RAG.** Before generating, retrieve real usage of each design-system component from the team's repo (props they use, wrappers, layout patterns) and the team's earlier accepted components, and put them in the brief as examples. | RAG over the codebase: retrieval of real examples, not a vector-database demo. Starts with lexical retrieval, then embeddings. |
| "Can we trust the numbers?" | **An eval benchmark.** A fixed set of frames × frameworks, run on every change of prompt or model: pass rate per check, attempts, cost. Plus the matcher's scored run (unblocked: Figma reset on Oct 1). | Evals are how AI products earn trust; models and prompts change monthly. |
| "Does it **keep** our codebase clean, not just new code?" | **The CI check.** A GitHub Action and `tulpar check` that review every pull request, **including code written by people**: invented components, hard-coded colours, undefined tokens. Optionally compared with the Figma frame linked in the PR. | The verifier is already built; this puts it where leads enforce standards. |
| "What does it give **me** as a lead?" | **A design-system health dashboard.** Adoption (design-system vs invented), hard-coded values over time, drift between Figma and code per release. | — |
| "Will output get better without us babysitting?" | **A smarter agent loop.** The repair step looks at the visual diff image (vision), not just text. Best-of-N candidates, picked by verifier score. Whole pages decomposed into components, generated and composed. A cheaper model for easy steps (model routing) and per-run cost shown. | Agentic loops with a real verifier as the reward signal: Tulpar's core advantage. |
| "Can our AI tools use it?" | **MCP++.** Done: `tulpar_generate`, `tulpar_verify`, `tulpar_projects`. Next: MCP *resources* (the team's component catalogue and tokens, so any assistant writes design-system code even without calling generate) and a `tulpar_check` tool. Research: reading Figma through Figma's own Dev Mode MCP server, which would avoid the REST budget (earlier research found it allow-lists clients; re-check). | MCP is the standard way assistants use tools. |
| "Is our code safe?" | **Privacy and self-hosting.** A clear data policy (OpenAI `store: false` is already set), self-hosted mode (the same Docker image inside a company network), bring-your-own model key, and Azure OpenAI / other providers behind the same `Llm` interface. | — |
| "Will it learn our style?" | **The data flywheel, then fine-tuning.** Record (design, accepted code, verifier report) and thumbs-up/down, with consent. **Fine-tuning comes later:** it needs thousands of good examples to beat retrieval plus a strong model, and the verifier already fixes most errors. When the data exists: preference tuning (DPO) of a smaller, cheaper model on verified outputs. | Fine-tuning is real, but premature today. RAG and verification give more value per dollar now. |

### Status and order (2026-10-17)

Live at tulparsi.com since 2026-10-11 (Fly.io; GitHub sign-in; free trial and Pro through Stripe). Done since v2 was written: G4 hosting, G9 for npm design systems (web "Add from npm", `tulpar init`), G10 Vue and Svelte, the VS Code extension on the Visual Studio Marketplace and Open VSX, interaction states, Tailwind/styled-components/Emotion, CI/CD that ships the tested image with a live check and rollback. Order of what remains:

1. ✅ **`tulpar check` and a GitHub Action** (`uses: hmamut39/Tulpar@main`): hard-coded values and invented tokens on every pull request, no model.
2. ✅ **The eval benchmark**: `tulpar eval`, 8 fixed cases across five frameworks, scored and compared run to run (on demand: each run costs model money).
3. ✅ **Repository RAG**: the team's own uses of each component go into the brief (lexical retrieval).
4. 🔄 **The smarter loop**: ✅ the repair sees its own render beside the design; ✅ cost per run shown; ✅ repairs start from the best attempt so far; ✅ best-of-N (`--candidates N`: independent drafts, each verified, the best repaired; opt-in); ✅ model routing (`TULPAR_OPENAI_DRAFT_MODEL`: a cheaper model writes first drafts, the main model repairs; each attempt priced at its own model's rate; opt-in, to be measured with `tulpar eval` before it becomes a default).
5. ✅ **MCP resources** (components and tokens per project) and `tulpar_check`.
6. ✅ **Self-hosting and bring-your-own model**: any OpenAI-compatible endpoint (Azure OpenAI, a gateway); docs/14.
7. **The first non-JavaScript stack** (Flutter).

### Launch plan

| Stage | When | What |
|---|---|---|
| **Private beta** | As soon as hosting exists (an account is needed) | Hosted at the chosen domain, behind invite codes and a spending cap. 5–10 front-end developers and leads try it on real work, and their feedback goes into the plan. |
| **Public beta** | After G9, the CI check and the eval benchmark meet their targets | GitHub sign-in, per-user limits, VS Code Marketplace listing, docs site. |
| **1.0** | After the public beta shows retention | Pricing (e.g. free for individuals, paid for teams with CI, dashboard and self-hosting), licence decided (open core is likely). |

### Domain (checked 2026-10-10 by DNS, not a registrar)

- **Taken:** `tulpar.ai` (parked for sale at a broker), `tulpar.dev`, `tulpar.app`, `tulpar.io`.
- **Appear free:** `gettulpar.com`, `usetulpar.com`, `tulparhq.com`.
- **Unclear:** `tulparai.com`. Check it at a registrar.
- **Before buying:** "Tulpar" is a common name (airlines and trains in Kazakhstan and Türkiye use it). Search trademarks in software (class 9/42) before committing to the name for a company.

## Ideas from the owner

_Add ideas here, and they'll be folded into the roadmap._

-


## Hard parts, stated up front

- **A hosted app spends the owner's money.** Every generation is an OpenAI call, and repairs add more. The app needs sign-in or invite codes, per-user limits and a spending cap before it is public.
- **Company confidentiality.** Teams at large companies usually may not send internal designs or code to a third-party website. The hosted app serves public and personal use; companies need the local or self-hosted mode (the same app, run inside their network) and the IDE extension.
- **Running generated code safely on a server.** It is bundled without being executed, then rendered only inside headless Chromium with the network blocked. Generated tests run in Vitest browser mode, inside the same locked-down Chromium. The server never executes generated Node code.
- **Screenshots carry far less than Figma:** no component names, tokens or exact layers. Recognition relies on the vision model, and verification falls back to pixel comparison. The report must say so.
- **The user's own design system.** The hosted app starts with the design systems it knows (Carbon Web Components and Carbon React). Indexing a user's private repository is the self-hosted or IDE mode's job.
- **Figma access.** Each user connects their own Figma (a personal access token at first, OAuth later). The owner's free-plan API budget cannot serve other people.
