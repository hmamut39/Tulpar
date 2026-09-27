# G2–G3: the web page — v1 (2026-09-27)

The first version of the Tulpar web page:
1. Paste a Figma frame link and pick a project (design system + framework).
2. Tulpar writes the component, builds and renders it, checks it against the design, and repairs what fails.
3. You get the files, the render, the checks and a zip download.

It runs the same pipeline as the command line (`tulpar generate`).

## Run it on your machine

```sh
cp .env.example .env        # then fill in OPENAI_API_KEY (and FIGMA_TOKEN if it isn't set in Windows already)
npm install
npm run web                 # → http://localhost:4173
```

The page offers every project under `examples/` (today Carbon Web Components and Carbon React). Each needs `npm install` in its folder once. Without `OPENAI_API_KEY` the page loads, but generation is switched off and the page says so.

## What the page does

| Step | What happens |
|---|---|
| **Figma link** | Any form Figma produces (`/design/`, `/file/`, `/proto/`, branch links, `node-id=12-34` or `12%3A34`). A link to a whole file is refused with instructions ("select the frame → Copy link to selection"). |
| **Figma access** | A frame read before is served from the cache. A new frame is fetched once with the visitor's **own** Figma token (a field on the page, optionally remembered in their browser only), then cached. |
| **Other Figma files** | A team's feature file that uses the library doesn't share node ids with the library file. Its instances are mapped by the library components' **stable keys**. |
| **Generation** | The model gets the brief: the design outline, each instance's design-system component with its props translated (`Style=Secondary` → `kind="secondary"`), the components' real APIs, and value-matched tokens. An optional screenshot goes along as an image. |
| **Verify and repair** | Build → render in Chromium (network blocked) → the layered checks. Failures go back to the model, up to 3 attempts. |
| **Result** | A banner (verified / no failures but some checks couldn't run / still failing), every check with its details, the render, the files with a copy button, and **Download .zip** (files + `tulpar-report.json`). |

The command line gained the same Figma-link input: `tulpar generate examples/carbon-react --figma "<link>" --name CheckoutCard`.

## Safety for hosting

- **Access code.** With `TULPAR_ACCESS_CODE` set, every generation needs it. The code is compared in constant time and never sent back to the page. **Set it whenever anyone but you can reach the page: every run spends your OpenAI key.**
- **Limits:**
  - generations per visitor per hour (`TULPAR_RUNS_PER_HOUR`, default 10);
  - a 12 MB request limit and an 8 MB screenshot limit;
  - one generation at a time, the rest queued.
- **The visitor's Figma token** is used for their job only. It is deleted when the job ends, never logged, and never returned in any response (a test checks this).
- **Generated code never runs on the server.** It is bundled by esbuild without being executed, and rendered only in headless Chromium with every network request blocked. Generated tests are delivered, not run.
- **Static files** are served only from `web/public`. Path tricks (`../`, encoded `%2e%2e`) get 404 (tested).
- **OpenAI requests** set `store: false`, so designs and code aren't kept on OpenAI's side.

## Hosting

`Dockerfile` builds one container:
- Node 24 and Playwright's Chromium;
- the example projects, from their lockfiles;
- Carbon's Code Connect files, cloned from GitHub.

Figma data lives in a volume (`/app/data`). Run it with:

```sh
docker build -t tulpar .
docker run -p 8080:8080 --env-file .env -v tulpar-data:/app/data tulpar
```

**Not yet tested:** this machine has no Docker, so the image has not been built here. The first deploy will be its test.

To go live:
1. Pick a container host with a persistent volume, e.g. Fly.io, Render or Google Cloud Run.
2. Set `OPENAI_API_KEY` and `TULPAR_ACCESS_CODE` as secrets there, never in the image.
3. Set a monthly spending limit in the OpenAI dashboard as a second guard.
4. Fill the data volume: copy `.cache/figma` and `out/library.json` from this machine, or run `tulpar library` on the server with a Figma token.

## Tests

- **API** ([web/test/server.test.ts](../web/test/server.test.ts)):
  - config without secrets;
  - access code required;
  - input errors;
  - static path safety;
  - a full generation through the API with a scripted model (token never echoed; the render and the zip served);
  - the hourly limit.
- **In a real browser:** the page was driven end to end with Playwright:
  - the bad first attempt caught and repaired;
  - the result, render and files tabs;
  - the zip download;
  - phone width in dark mode.

## Screenshot only (G5)

A screenshot alone is enough, on the page (leave the Figma link empty) and on the command line (`tulpar generate <project> --image shot.png --name Card`):

1. **Read.** The vision model reads the picture into the same design model a Figma frame produces. It gets the design system's real catalogue (component names, prop values, slots), names only components that exist, and gives each element a box in image pixels and a confidence.
   - An invented component becomes a plain container, with a note.
   - Boxes are converted to design points using the screenshot's scale: auto, 1×, 1.5×, 2× or 3×.
2. **Content, not internals.** Elements inside a design-system component (buttons inside a button set) are **content placed into it**, which the code must build. So they are tagged and checked individually. This needed a new `content` field on instances in the core model. The first real run showed why: without it, the buttons were never checked.
3. **Generate and verify** as usual, with two differences stated in the report:
   - layout is checked within ±16 pt, because boxes read from a picture are estimates;
   - the typeface check is skipped, because a picture doesn't name its fonts.
4. **Pixel comparison.** With a PNG screenshot, the render is compared with the picture pixel by pixel (pixelmatch, anti-aliasing ignored, limit 8% differing pixels). Where it differs is reported and attributed to elements. This is the strongest evidence in screenshot mode.

**Real run** (the footer PNG, React, via the web page): 3 of 3 design-system components, layout within tolerance on 4 of 4 elements, text exact, **0.0% of pixels differ**.

The reader's own notes claimed the primary button had "a white right-pointing arrow". There is no arrow. The code didn't add one, and the pixel comparison confirms the render matches the picture: the picture is the ground truth, not the model's description of it.

## Not in v1 (next in the roadmap)

- **Sign-in and per-user accounts** (G4). v1 has a shared access code.
- **Choosing your own design system** (G9). v1 offers the built-in examples.
- **Angular and other stacks** (G6, G10).
