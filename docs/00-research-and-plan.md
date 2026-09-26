# Tulpar: research and plan

Design-to-code with maintained mapping and real verification.

Status: research only, no product code yet. Checked against primary sources on 2026-09-26.
Anything marked **(unverified)** could not be confirmed from a primary source and must be checked before we depend on it.

---

## 0. The blunt summary

1. **Automatic mapping is no longer unclaimed.**
   - Figma's own MCP server now ships `get_code_connect_suggestions` ("Detects and suggests mappings of Figma components to code components in your codebase") and `send_code_connect_mappings`. There is also an official `figma-code-connect` agent skill that searches the repository and writes `.figma.ts` templates.
   - Builder.io (Enterprise), Anima, Kombai and Locofy all advertise automatic component matching. Bitovi's open-source Superconnect does it with an LLM.
   - **What nobody does:** keep the mapping correct as both sides drift, show calibrated evidence for each match, work without Figma Organization/Enterprise, or cover Flutter, Svelte, Blazor/XAML and Rust. That is the defensible slice of pillar 1. It is narrower than the brief assumed, and Figma could close part of it at any time.
2. **Visual comparison against a Figma frame is also no longer unclaimed.**
   - Applitools launched "Figma Design Baselines" on 2026-09-15: pass a Figma frame URL as the visual baseline.
   - QA Proof and Uiprobe do web-only design-fidelity checks. Figma's own design-to-code skill tells the agent to "validate against Figma … before marking complete". That check is a prompt instruction, not something enforced.
   - **What nobody does:** one deterministic report that combines four checks: it built and rendered; design-system components used vs invented; tokens vs hard-coded values; a structural and visual diff against the frame. Nobody does it for any non-web stack. Every Figma-diff tool I found is DOM-based.
3. **So the product is a verification-and-mapping layer that sits beside whatever generates the code.** That covers Figma MCP, Cursor, Claude Code, Builder and others. It does not compete with them. Generation stays a thin, swappable step. This matches your brief. The research makes it a necessity rather than a preference.
4. **tree-sitter + LSP cannot be the universal reading layer.**
   - tree-sitter has no types, no cross-file resolution and no macro expansion.
   - LSP returns hover *strings*, not structured types, and needs about eleven full toolchains that build.
   - The layer that works is tiered: curated manifests, then each ecosystem's compiler-backed extractor, then LSP, then tree-sitter as the always-on fallback. Provenance and confidence are recorded per field.
5. **Hard external limits:**
   - The Figma Variables REST API and Library Analytics are **Enterprise-only**.
   - Code Connect needs **Organization or Enterprise**.
   - The Figma MCP server only accepts **allow-listed clients**, so a third-party tool cannot be an MCP client. We build on REST.
   - REST Tier 1 (file, nodes, images) allows only **10–30 requests per minute**.
   - Apple's macOS licence allows VMs only on Apple hardware and forbids service-bureau use, so **we cannot run a hosted SwiftUI render farm for customers**.
   - Pixel-exact equality with Figma is **impossible**, because text rasterisation and line-height models differ by design.
6. **Consequence for architecture:** verification runs where the customer's toolchain lives, as a CLI, a CI action and an MCP tool. It does not run on our servers. That is also the cheapest shape for a solo founder.

---

## 1. Reading a design system from a repository, across languages

### What works per stack

| Stack | Best extractor (tier) | Confidence | Where it fails |
|---|---|---|---|
| React/TS | Storybook component manifest (preview, SB 10.6); react-docgen-typescript / React Component Meta (TS checker); literal read of `cva()`/`tv()` for variants | High | Polymorphic `as`, HOCs; inherited DOM props need filtering; slow on big repos |
| Vue | `vue-component-meta` (Volar, TS checker) | High | Needs a valid tsconfig |
| Svelte | svelte2tsx + TS (what Storybook uses), or `sveld` | Med-High | Deep types not expanded |
| Angular | Compodoc JSON (signal inputs supported) | Med-High | `ng-content` slots need a template parse |
| Web Components | `custom-elements.json` (CEM analyzer), Stencil `docs-json` | Med-High | CEM stores types as text; slots, parts and CSS props depend on JSDoc |
| SwiftUI | SwiftSyntax (defaults, structure) + symbol graph (resolved types) | Medium | Symbol graph has **no default values**; needs a macOS build |
| Compose | Kotlin Analysis API (standalone, unstable) or KSP + PSI/tree-sitter for default text | Medium | KSP exposes only `hasDefault`; Gradle/Android in CI |
| Flutter | Dart `analyzer` package (resolved elements, `defaultValueCode`) | High | Needs `pub get`; element-model API churn |
| Blazor | Roslyn + Razor source generator (`[Parameter]`, `RenderFragment`, `EventCallback`) | High | Needs `dotnet restore` |
| XAML | Roslyn for `DependencyProperty`/`BindableProperty`; XML for resources and styles | Low-Med | Registration patterns vary; styles-as-variants are implicit |
| Leptos/Dioxus/Yew | `syn` on `#[component]`/`#[prop]`/`#[derive(Props)]`; rustdoc JSON (nightly) or rust-analyzer for types | Medium | Proc macros hide the real props struct |

Sources:
- tree-sitter parser list: https://github.com/tree-sitter/tree-sitter/wiki/List-of-parsers
- Storybook manifests: https://storybook.js.org/docs/ai/manifests
- react-docgen-typescript: https://github.com/styleguidist/react-docgen-typescript
- vue-component-meta: https://github.com/vuejs/language-tools/tree/master/packages/component-meta
- Custom Elements Manifest analyzer: https://custom-elements-manifest.open-wc.org/analyzer/getting-started/
- Stencil docs-json: https://stenciljs.com/docs/docs-json
- SymbolKit `FunctionParameter` (no default field): https://github.com/swiftlang/swift-docc-symbolkit
- KSP issue on default values: https://github.com/google/ksp/issues/268
- Kotlin Analysis API: https://kotlin.github.io/analysis-api/index_md.html
- Dart analyzer: https://pub.dev/documentation/analyzer/latest/
- rustdoc-types: https://github.com/rust-lang/rustdoc-types
- Leptos components: https://book.leptos.dev/view/03_components.html

### How far tree-sitter and LSP actually get us

**tree-sitter**
- **What it does well.** Fast, build-free and uniform across every target language. It finds candidate components by pattern (`@Composable`, `: View`, `extends StatelessWidget`, `ComponentBase`+`[Parameter]`). It reads props *as written*, default-expression text and doc comments. It reads `cva`/`tv` variant literals, which are often the best variant signal. It also reads CSS/XAML/xcassets tokens. My estimate (unmeasured) is 60–70% of a useful inventory.
- **Where it fails:**
  - anything needing types: `Omit<…> & VariantProps<…>`, re-exports, inherited DOM props, unions through aliases;
  - anything generated: Rust proc macros, Razor generators, the Compose compiler;
  - deciding whether a class is actually a component.
- **Grammar quality varies.** The Vue grammar is thin. Angular's covers templates only. Razor's is small. XAML is just XML.
- GitHub's `stack-graphs` (name resolution on tree-sitter) was **archived 2025-09-09**. Do not build on it.

**LSP**
- **What it adds.** Resolved type *strings* via hover and typeDefinition.
- **Where it falls short:**
  - The protocol has no structured-type request. You end up parsing markdown that differs per server.
  - Every server needs its toolchain and a project that resolves.
  - The official Kotlin LSP is **alpha**. rust-analyzer only expands proc macros after a cargo build.
  - Running around eleven language servers headless in CI is an operations burden, not a strategy.
- **SCIP** (Sourcegraph) is better for batch indexing but still stores signatures as text. There is no Swift indexer.

**Decision.** Use a tiered reader with provenance on every field:
0. **Curated sources:** Storybook manifest, `custom-elements.json`, `docs-json`, DTCG token files, existing Code Connect files.
1. **Native compiler-backed extractor**, run inside the adapter.
2. **LSP/SCIP**, only for resolved type strings.
3. **tree-sitter heuristics** as the baseline that always runs.

The normalised record keeps both `type_text` and `resolved_type?`, both `default_text` and `enum_values?`. Every field carries `source` and `confidence`.

### Tokens

- **DTCG format.** The W3C Design Tokens format reached a **stable 2025.10** release on 2025-10-28. Style Dictionary v5 reads it natively. We use DTCG as the core's token model.
  - Announcement: https://www.w3.org/community/design-tokens/2025/10/28/design-tokens-specification-reaches-first-stable-version/
- **Reading tokens from Figma.** Figma REST gives `boundVariables` (IDs only) on every plan. Names and values need the Variables REST API, which is **Enterprise only**.
  - Docs: https://developers.figma.com/docs/rest-api/variables
  - Fallback 1: repository token files, which usually exist.
  - Fallback 2: styles.
  - Fallback 3: a small companion Figma plugin that exports variables. I found no plan restriction on the plugin API **(unverified)**.
- **Where tokens live in code:**

  | Platform | Location | Extraction |
  |---|---|---|
  | Web | CSS custom properties, Tailwind v4 `@theme` | Easy |
  | SwiftUI | `.xcassets` JSON, plus `Color` extensions | Heuristic for the extensions |
  | Compose | `MaterialTheme` / `CompositionLocal` | Heuristic |
  | Flutter | `ThemeData` + `ThemeExtension` | Via analyzer |
  | XAML | `ResourceDictionary` | Easy |

---

## 2. Matching a Figma component to a code component when names disagree

### The Figma side

- **Component data.** `GET /v1/files/:key` returns `components` and `componentSets`. Each carries a stable `key`, `description` and `documentationLinks` (often a Storybook URL, which is a free high-precision signal).
- **Property definitions.** Component sets carry `componentPropertyDefinitions`:
  - types are `VARIANT` / `BOOLEAN` / `TEXT` / `INSTANCE_SWAP`;
  - non-variant names carry a `#id` suffix to strip;
  - variant names are encoded as `Size=Large, State=Hover`.
- **Instances.** Instances carry `componentId`, `componentProperties` and `overrides`. `componentPropertyReferences` tells which layer each property drives.
- **Dev resources.** Readable and writable over REST. They are another link signal and a place to write confirmed links back.
- **Webhooks v2.** `LIBRARY_PUBLISH` lists created, modified and deleted components, styles and variables. It can arrive split per asset type, so debounce it.
- **Code Connect cannot be read back through REST.** There is no endpoint in the OpenAPI spec. The only read path is MCP `get_code_connect_map`, which is allow-listed. **Ground truth comes from the repository's `.figma.*` files.**
- Sources:
  - REST API spec: https://github.com/figma/rest-api-spec
  - Webhooks: https://developers.figma.com/docs/rest-api/webhooks-events/
  - Rate limits: https://developers.figma.com/docs/rest-api/rate-limits/
  - MCP tools: https://developers.figma.com/docs/figma-mcp-server/tools-and-prompts/

### Signals, strongest first

1. **Explicit links.** An existing Code Connect file, Storybook `parameters.design.url`, Figma `documentationLinks` / dev resources, or a code name in the Figma description. Treat these as hard matches. They are also training labels.
2. **Prop-shape alignment.**
   - Normalise names: strip `#id`, camelCase, apply synonyms (variant/kind/appearance, disabled/isDisabled, leadingIcon/iconBefore).
   - Map types: VARIANT→union/enum, BOOLEAN→bool, TEXT→string/children, INSTANCE_SWAP→slot.
   - Score by Hungarian assignment at the prop level.
3. **Variant value-set overlap.** Jaccard on normalised enum values. Very discriminative when the sets are large.
4. **Name and alias similarity.** Tokenised Figma path vs export name, file and folder. Uses trigram / Jaro-Winkler plus a small embedding, and expands abbreviations.
5. **Visual similarity.** Figma component render vs rendered story. Expensive (Tier 1 budget), so it is a tie-breaker for the top 3 only.
6. **Structure.** Layer tree vs sub-components and slots. Weak.
7. **Usage frequency.** Library Analytics (Enterprise only) vs import counts. A weak prior. Mostly useful for ranking which unmatched items matter.

### Scoring model

1. **Blocking.** Keep the top-k candidates per Figma component set, using BM25, trigram and embedding kNN.
2. **Explicit links.** Score them p = 1 and remove them from assignment.
3. **Per-pair features.** Keep a separate "signal missing" flag for each signal, so an absent screenshot never reads as a low score.
4. **Model.** Logistic regression, calibrated with Platt scaling. That suits the few-hundred labels we will have; move to isotonic above about 1,000.
5. **Assignment.** Rectangular Hungarian with a dummy "unmatched" column, so the model can abstain. Allow controlled 1:N (Button → Button + IconButton) and N:1 (Input/Text + Input/Password → TextInput).
6. **Abstain.** Report the pair as needing a human when p < τ, or when the margin to the runner-up is < δ.

Research this draws on:
- Valentine (schema matching): https://arxiv.org/abs/2010.07386
- Ditto (entity resolution): https://arxiv.org/abs/2004.00584
- Calibration for entity matching: https://arxiv.org/pdf/2509.19557
- None of the design-to-code papers solve mapping to an *existing* library. Figma2Code (https://arxiv.org/abs/2604.13648) inlines components instead.

### Labelled data exists, and that changes the plan

Public repositories with hand-written Code Connect files give labels:

| Repository | Code Connect files |
|---|---|
| Carbon | **162** (89 `packages/react`, 73 `packages/web-components`; I counted these myself) |
| Primer React | 51 |
| Innovaccer | 75 |
| Coveo Plasma | 47 |
| Contentful Forma 36 | 44 |

- That is roughly 400 positive pairs across 5+ systems.
- Evaluate leave-one-design-system-out.
- Hold out Fluent, Spectrum and Polaris as hand-labelled out-of-distribution tests; they have public kits and code but no Code Connect.

### Keeping it fresh

- **Anchor identity.**
  - Figma side: component and component-set `key`, plus file key and node id.
  - Code side: package + export + path, with git rename detection.
- **Store a prop-signature hash on each side.**
- **On change, classify the drift** as added, removed, renamed, value-set changed or type changed.
- **Triggers:**
  - a `LIBRARY_PUBLISH` webhook re-scores only changed components;
  - a git push re-extracts only changed files.
- **A confirmed mapping is never silently re-matched.** Drift becomes a finding for a human. The mapping is demoted only by a human or by a deletion.

### Showing confidence honestly

- **Four user-facing tiers**, backed by calibrated probabilities internally:

  | Tier | Meaning |
  |---|---|
  | **Verified** | Human-confirmed or explicitly linked |
  | **Likely** | Threshold chosen for ≥ 95% precision on held-out labels |
  | **Possible** | Below the Likely threshold, above τ |
  | **Unmatched** | Below τ, or the margin to the runner-up is below δ |

- **Every match shows its evidence per signal**, plus the runner-up. For example: "props 7/9 aligned · variant values 0.8 · name 0.62 · linked via documentationLinks".
- **Confirmed mappings export as Code Connect template files (`.figma.ts`) in the customer's repository.** No lock-in. They work with Figma's own tooling the day we disappear.

---

## 3. Verifying generated code automatically

### Per ecosystem

| Stack | Headless render | Runner | Maturity | Not verifiable on that path |
|---|---|---|---|---|
| Web (React/Vue/Svelte/Angular/WC/HTML), Blazor WASM, Leptos/Yew/Dioxus-web | Playwright in the pinned official Docker image | Linux | High | Real Safari/iOS; other OS rasterisers |
| Jetpack Compose | Paparazzi or Roborazzi (JVM; no device) | Linux | High (Google's own plugin still alpha) | Device GPU, OEM fonts |
| Compose Multiplatform desktop | `runComposeUiTest` + `captureToImage` | Linux | Experimental API | iOS/Android look |
| Flutter | `flutter test` + `matchesGoldenFile` (**must load real fonts**; default is Ahem boxes) | Linux | High | Impeller vs test renderer **(unverified)** |
| SwiftUI | `ImageRenderer` / swift-snapshot-testing in XCTest | **macOS only** | Med-High | iOS look when hosted on macOS; `ImageRenderer` drops List, ScrollView and UIKit-backed views |
| WPF | `RenderTargetBitmap` | Windows | High | — |
| WinUI 3 | `RenderTargetBitmap.RenderAsync` (needs a real window) | Windows | Med-Low | Popups/flyouts |
| .NET MAUI | No headless path; device tests or Appium only | Emulators | Low | Almost everything without devices |
| Avalonia | `Avalonia.Headless` (Skia) | Linux | High | — |
| Dioxus native (Blitz) | Alpha, no capture API | — | Low | Use its web target instead |

Sources:
- Playwright snapshots: https://playwright.dev/docs/test-snapshots
- Paparazzi: https://github.com/cashapp/paparazzi
- Roborazzi: https://github.com/takahirom/roborazzi
- Flutter goldens: https://api.flutter.dev/flutter/flutter_test/matchesGoldenFile.html
- swift-snapshot-testing: https://github.com/pointfreeco/swift-snapshot-testing
- Apple macOS licence: https://www.apple.com/legal/sla/docs/macOSTahoe.pdf

Playwright's experimental component-testing packages have been **removed**. Render through a plain harness page instead.

### Methodology: a layered verdict, never a single percentage

1. **Normalise.**
   - Figma: `GET /v1/images` with a pinned `version`, `use_absolute_bounds=true` and scale S.
   - Implementation: rendered at the frame's width and height with device scale S, on the same background.
   - A size mismatch is itself a finding.
2. **Structure and layout (primary signal).**
   - The emitter tags every element with its Figma node id: `data-figma-id` on web, `testTag` in Compose, `accessibilityIdentifier` in SwiftUI, `Key` in Flutter.
   - Compare boxes against `absoluteBoundingBox`.
   - Starting tolerances (ours, not an industry standard): ±1 px for boxes, ±2–4 px for text boxes.
3. **Provenance.**
   - Every Figma INSTANCE should map through the component mapping to a design-system import. Otherwise it counts as **invented**.
   - Every Figma `boundVariables` field should be a token reference in code. Otherwise it counts as **hard-coded**.
   - On web, CDP `CSS.getMatchedStylesForNode` shows whether the value came through `var(--token)`. `getComputedStyle` cannot tell you that.
   - Everywhere, a static AST pass finds literals.
4. **Values.** Compare fills, radius, spacing and type style against resolved values. Colour passes at ΔE2000 below about 1–2.
5. **Text.** Compare TEXT `characters` with the rendered text, exactly.
6. **Perceptual image diff (supporting evidence only).**
   - Use pixelmatch or SSIM. Cluster the diff regions and attribute each region to named elements, e.g. "region over Button/Primary: icon missing".
   - Text glyph interiors will always differ between Figma's rasteriser and any platform's, so down-weight them.

Every check returns **pass**, **fail** or **not checked (reason)**. The report headline is built only from checks that ran. For example:

> CheckoutCard · 6 of 6 design-system components · 0 hard-coded colours · layout within tolerance on 41/41 elements · text exact · hover/pressed states **not checked** (no Figma variants rendered)

The existing Applitools Figma baseline product does not report component or token provenance. Its page says nothing about it.

### Genuinely not verifiable today (the report must say "not checked", never "pass")

- **Interaction states:** hover, focus, pressed. Checkable only when Figma has a variant for the state and the adapter can force the state.
- **Animation and transitions.**
- **Responsive behaviour** beyond the sampled widths.
- **Real, long or localised data;** text overflow.
- **Accessibility** beyond static checks.
- **Dark mode and theme modes,** unless each mode is rendered separately.
- **OS-drawn widgets:** pickers, web views, UIKit-backed SwiftUI.
- **The iOS look** from anything but a macOS/simulator run.
- **The "true device" look** on Android.
- **Anything where the Figma file itself is inconsistent:** detached instances, unbound literal colours. We report these as *design* findings, not code failures.

---

## 4. The adapter interface

### Rules that keep the core framework-free

1. **Adapters are separate executables speaking JSON-RPC over stdio**, the way LSP servers work. They are not plugins in the core's language.
   - A SwiftUI adapter is written in Swift, using SwiftSyntax.
   - A Compose adapter is written in Kotlin, using the Analysis API.
   - A Rust adapter is written in Rust, using `syn`.
   - Otherwise every native ecosystem forces a core change or a fragile bridge.
2. **The core speaks design concepts, never platform concepts.** Box, Stack (axis, gap, padding, align), Text, Image, Slot, Instance(component, props), and Token references.
   - Units are design points at a stated scale (px ≈ pt ≈ dp at 1×). Colours carry a colour space.
   - No CSS, DOM, className, ReactNode or `children` in the core schema.
3. **Every capability is optional and declared.** An adapter that cannot do something says so. The core turns that into "not checked", never into "pass".
4. **Adapters return facts; the core makes every judgement.** Adapters never decide pass or fail. The core compares.

### Sketch (types written in TypeScript for readability; the wire format is JSON)

```ts
interface AdapterManifest {
  id: string;                      // "web-components", "react", "compose", "swiftui"
  protocolVersion: string;
  detects: string[];               // e.g. ["package.json:@carbon/web-components"]
  capabilities: {
    index: boolean;
    tokens: boolean;
    emit: boolean;
    build: boolean;
    render: { supported: boolean; hostOS: ("linux"|"macos"|"windows")[]; reason?: string };
    runtimeStyleProvenance: boolean; // can tell token vs literal at runtime (web: yes via CDP)
    staticProvenance: boolean;       // AST literal / import analysis
    forceStates: ("hover"|"focus"|"pressed"|"disabled")[];
    themes: boolean;
  };
}

// Reading: returns normalized records with per-field provenance
index(repo): ComponentIndex        // components, props{name,type_text,resolved_type?,default_text?,
                                   //   enum_values?,required,kind: value|slot|event}, variants, slots,
                                   //   source + confidence per field
tokens(repo): DTCGTokenSet & { bindings: Record<tokenPath, codeReference> }
explicitLinks(repo): Link[]        // parsed Code Connect files, Storybook design URLs

// Writing: from the core's design model + approved mapping + tokens
emit(req: { design: DesignNode; mapping: Mapping; tokens: TokenRefs; idStrategy: "node-id" })
  : { files: File[]; unmet: UnmetRequirement[] }  // e.g. "no component for Figma 'Badge'"

// Proving
build(workspace): { ok: boolean; log: string }
render(req: { entry: string; width: number; height: number; scale: number; theme?: string; state?: string })
  : { status: "ok"; png: Bytes; elements: RenderedElement[] }   // id, box, text, resolved style, style provenance
  | { status: "unsupported"; reason: string }
analyze(files): { imports: DSImport[]; literals: Literal[]; unknownComponents: string[] }
```

A new target implements this and nothing else. If a SwiftUI adapter hits something the schema cannot express, that is a bug in the *core model*, and we fix it once for everyone. The second non-web adapter is what flushes those out.

---

## 5. Which adapter first, and why

**Web Components, specifically Carbon's `@carbon/web-components`, followed immediately by Carbon React against the same Figma file.** The choice is driven by proving the core, not by popularity.

1. **Ground truth exists.**
   - Carbon keeps 73 hand-written Code Connect files for its web components and 89 for React.
   - They point at a **public** Figma kit (https://www.figma.com/community/file/1157761560874207208).
   - We can *measure* matching precision and recall with those files hidden, instead of eyeballing it. No other open-source design system gives us this for two frameworks at once.
2. **Tier-0 metadata ships in the package.** `@carbon/web-components@2.64.0` ships a 1.4 MB `custom-elements.json` (I checked with `npm pack --dry-run`). The index needs no compiler work for the first milestone.
3. **Tokens are CSS custom properties (`--cds-*`).** The token-vs-literal check is exact, via CDP, not heuristic.
4. **Verification is the most mature path.** Playwright on Linux in Docker: free and deterministic.
5. **It is not React.** Custom elements have attributes, properties, slots, events and CSS parts. They have no JSX, `children` props or ReactNode. The core cannot quietly absorb React-isms.
6. **Adding React second, against the same Figma file and labels, is the cleanest test of the adapter boundary we can buy.** Success means: the React adapter lands with **zero lines changed in the core**.

The third adapter should be **Jetpack Compose** (Paparazzi/Roborazzi, Linux JVM). It is the first non-web target, and it avoids the macOS/EULA constraint that SwiftUI brings.

---

## 6. The smallest end-to-end proof

**Inputs:**
- repository: `carbon-design-system/carbon` (the `web-components` and `react` packages);
- Figma: our own duplicate of the Carbon community kit, plus 3 real frames built from it.

The frames, in increasing difficulty:
1. a sign-in form;
2. a card with tags and buttons;
3. a modal with a data list.

| # | Milestone | Done means (measured, not claimed) |
|---|---|---|
| 0 | **Access spike** (1–2 days) | A personal access token reads the duplicated kit's file, components and images. We confirm whether Code Connect node ids resolve in *our* duplicate or need a name+variant join. **Biggest unknown; do first.** |
| 1 | **Design model** | Figma → normalised design model JSON for the 3 frames and the library. Round-trip test: re-rendering the model's boxes reproduces `absoluteBoundingBox` exactly. |
| 2 | **Index + tokens** (web-components adapter) | Component index from `custom-elements.json`; DTCG tokens from Carbon's theme package. Coverage report on the index: how many components and props, and which fields are low-confidence. |
| 3 | **Matcher, scored** | With the 73 Code Connect files hidden: precision per tier, recall, abstention rate and calibration error. **Gate: "Likely" tier ≥ 95% precision.** If it misses, we learn that now, cheaply. |
| 4 | **Verifier, and proof that it is honest** | For each frame: generate code (a thin LLM call with mapping and tokens as context; generation is not the product), build, render in the pinned Playwright image, and produce the layered report. Then **mutation tests**: inject a hard-coded hex, an invented `<div>` button, an 8 px shift and a wrong label. **The verifier must catch every mutation.** Any it misses is a bug in the product's core promise. |
| 5 | **Second adapter** | React adapter (react-docgen-typescript) on the same Figma file: matcher scored against the 89 React labels, and the same 3 frames verified. **Gate: zero core changes.** |
| 6 | **Drift (stretch)** | Replay two Carbon releases: detect renamed, added and removed props against confirmed mappings, and report them as findings. |

**Out of scope for the proof:**
- any UI beyond a CLI and an HTML/Markdown report;
- webhooks and hosting;
- native adapters;
- ML beyond logistic regression + Platt scaling;
- multi-tenant anything.

**Shape:**
- a TypeScript monorepo: `core/`, `adapters/web-components/`, `adapters/react/`, `cli/`;
- the adapter protocol over stdio from day one, even though the first two adapters are also TypeScript. That keeps us honest.

---

## 7. Risks, ranked

1. **Figma moves into this space.**
   - They already suggest mappings and have said "automated mapping" is coming to the Code Connect UI (secondary source).
   - Mitigation: our value is the maintained, evidenced mapping plus provenance verification, across plans and stacks. It is exported *as* Code Connect, so we complement Figma rather than compete with its storage.
2. **Plan gating.** Code Connect is Organization/Enterprise only; Variables REST and Analytics are Enterprise only; Tier 1 rate limits are small.
   - Design for Professional-plan customers: repository tokens, and a companion plugin for variables.
3. **Matching quality on messy real systems.** Carbon and Primer are unusually tidy.
   - The held-out hand-labelled set (Fluent, Spectrum, Polaris) is where we find out.
4. **Native verification cost.**
   - Each stack is its own harness, font setup and CI image.
   - SwiftUI must run on customer-owned Macs.
   - This is the long-term moat and the long-term drag. Add native stacks one at a time, when a user asks for them.
5. **Figma text and layout semantics vs platforms.** Line-height and text-box models differ.
   - Tolerances need tuning per adapter, and the report must say which tolerance applied.

## 8. Open questions for you

- Which Figma plan do you have? It decides whether we can test Variables REST and Code Connect directly, or must use the fallbacks from day one.
- License. The repository is public with no license for now: the code is visible but not reusable. Decide between staying source-available and open-sourcing (e.g. Apache-2.0) before accepting outside contributions.

Decided: name **Tulpar** (تۇلپار, the winged horse of Turkic legend); public repository at https://github.com/hmamut39/Tulpar.
