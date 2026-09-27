// The verifier's core promise: every injected defect is caught, by the right check.
// Each mutant is the hand-written reference implementation with exactly one defect.

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { Check, VerifyReport } from "@tulpar/core";
import { verifyCommand } from "../src/verify.ts";

const repo = resolve(import.meta.dirname, "../..");
const project = join(repo, "examples/carbon");
const frame = "3906:50588";
const ready =
  existsSync(join(project, "node_modules/@carbon/web-components")) &&
  existsSync(join(repo, "out/library.json")) &&
  existsSync(join(repo, ".cache/figma/b8xYgmx2Js30XaldxPkOs9/nodes/410-13792.json"));

const SECONDARY = `<cds-modal-footer-button kind="secondary" data-figma-id="4122:87677">Button</cds-modal-footer-button>`;
const PRIMARY = `<cds-modal-footer-button kind="primary" data-figma-id="4122:86445">Button</cds-modal-footer-button>`;

const mutants: { name: string; mutate: (html: string) => string; fails: Check["id"]; detail: RegExp; alsoPasses?: Check["id"][] }[] = [
  {
    name: "hard-coded hex colour",
    mutate: (h) => h.replace(PRIMARY, PRIMARY.replace('data-figma-id', 'style="background-color: #0f62fe" data-figma-id')),
    fails: "colors",
    detail: /#0f62fe/,
  },
  {
    name: "invented <button> instead of the design-system button",
    mutate: (h) => h.replace(PRIMARY, `<button data-figma-id="4122:86445">Button</button>`),
    fails: "components",
    detail: /invented/,
  },
  {
    // Carbon's spacing tokens are not global CSS variables; its own styles always give a fallback.
    name: "8 px shift, made with a spacing token so only layout can catch it",
    mutate: (h) => h.replace(SECONDARY, SECONDARY.replace('data-figma-id', 'style="position: relative; left: var(--cds-spacing-03, 0.5rem)" data-figma-id')),
    fails: "layout",
    detail: /x 0 → 8 \(\+8\)/,
    alsoPasses: ["spacing", "colors"],
  },
  {
    name: "wrong label",
    mutate: (h) => h.replace(`kind="primary" data-figma-id="4122:86445">Button<`, `kind="primary" data-figma-id="4122:86445">Buton<`),
    fails: "text",
    detail: /design says "Button", rendered "Buton"/,
  },
  {
    name: "missing import: the tag matches, but the component never loads",
    mutate: (h) => h.replace(/<script type="module">[\s\S]*?<\/script>/, ""),
    fails: "components",
    detail: /never loaded/,
  },
  {
    name: "another design-system component in the wrong place",
    mutate: (h) =>
      h
        .replace(PRIMARY, `<cds-tag data-figma-id="4122:86445">Button</cds-tag>`)
        .replace("</script>", "  import '@carbon/web-components/es/components/tag/index.js';\n</script>"),
    fails: "components",
    detail: /another design-system component/,
  },
  {
    name: "hard-coded font size",
    mutate: (h) => h.replace(SECONDARY, SECONDARY.replace('data-figma-id', 'style="font-size: 16px" data-figma-id')),
    fails: "type",
    detail: /fontSize: 16px/,
  },
];

async function run(name: string, html: string): Promise<VerifyReport> {
  const dir = join(project, ".tulpar", "mutations");
  await mkdir(dir, { recursive: true });
  const file = `${name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.html`;
  await writeFile(join(dir, file), html);
  const { report } = await verifyCommand(project, `.tulpar/mutations/${file}`, { frame, out: join(repo, "out"), cache: join(repo, ".cache/figma"), quiet: true });
  return report!;
}

const failing = (r: VerifyReport) => r.checks.filter((c) => c.status === "fail").map((c) => c.id);

describe.skipIf(!ready)("verifier on the Carbon modal footer", () => {
  let reference: string;
  let baseline: VerifyReport;
  beforeAll(async () => {
    reference = await readFile(join(project, "impl/modal-footer.html"), "utf8");
    baseline = await run("reference", reference);
  }, 120_000);

  it("passes every check that runs on the reference, and says what it could not check", () => {
    expect(failing(baseline)).toEqual([]);
    expect(baseline.verdict).toBe("incomplete");
    // The Web Components adapter cannot run tests yet; it says so.
    expect(baseline.checks.filter((c) => c.status === "not-checked").map((c) => c.id)).toEqual(["tests", "visual", "states"]);
    expect(baseline.headline).toContain("3 of 3 design-system components used, 0 invented");
  });

  for (const m of mutants) {
    it(`catches: ${m.name}`, async () => {
      const mutated = m.mutate(reference);
      expect(mutated).not.toBe(reference);
      const report = await run(m.name, mutated);
      expect(report.verdict).toBe("fail");
      const check = report.checks.find((c) => c.id === m.fails)!;
      expect(check.status).toBe("fail");
      expect(check.details.join("\n")).toMatch(m.detail);
      for (const id of m.alsoPasses ?? []) expect(report.checks.find((c) => c.id === id)!.status).toBe("pass");
    }, 120_000);
  }
});
