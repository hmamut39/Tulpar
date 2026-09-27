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

## Phases

| Phase | What | Done means |
|---|---|---|
| G1 | **Generation engine** in the core: the design model, mapping, tokens and the adapter's file conventions go to the model; files come back; they are verified; failures are fed back for repair | A Figma frame produces React files that pass the verifier. The loop is tested with a scripted model; real runs use OpenAI |
| G2 | **Web app, hosted:** paste a Figma link or upload an image; watch generation and verification; see files, render and report; download a zip | Deployed behind access control, with per-user rate limits (the owner's OpenAI key pays for every run) |
| G3 | **Screenshot input:** OpenAI vision reads the image into the same design model, recognising design-system components | Works on screenshots of the test frames; image-based results are marked lower confidence |
| G4 | **Angular:** adapter (index, build, render, identify) and generator (`.ts`, `.html`, `.less`, `.spec.ts`) | The same frames verified in Angular; zero core changes |
| G5 | **IDE:** a VS Code extension and an MCP server, so generation runs from the editor and files land in the workspace | Generate from a Figma link inside VS Code |
| G6 | **HTML reports and a public project page** | Reports open in a browser; the project page shows the proof results |

## Hard parts, stated up front

- **A hosted app spends the owner's money.** Every generation is an OpenAI call, and repairs add more. The app needs sign-in or invite codes, per-user limits and a spending cap before it is public.
- **Company confidentiality.** Teams at large companies usually may not send internal designs or code to a third-party website. The hosted app serves public and personal use; companies need the local or self-hosted mode (the same app, run inside their network) and the IDE extension.
- **Running generated code safely on a server.** It is bundled without being executed, then rendered only inside headless Chromium with the network blocked. Generated tests are delivered, and marked "not run" until a sandboxed test runner exists. The server never executes generated Node code.
- **Screenshots carry far less than Figma:** no component names, tokens or exact layers. Recognition relies on the vision model, and verification falls back to pixel comparison. The report must say so.
- **The user's own design system.** The hosted app starts with the design systems it knows (Carbon Web Components and Carbon React). Indexing a user's private repository is the self-hosted or IDE mode's job.
- **Figma access.** Each user connects their own Figma (a personal access token at first, OAuth later). The owner's free-plan API budget cannot serve other people.
