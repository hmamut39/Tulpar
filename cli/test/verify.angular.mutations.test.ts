// The verifier's promise, in Angular: every injected defect is caught by the right check.
// Each mutant is the hand-written reference with exactly one defect in one of its files.

import { existsSync } from "node:fs";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { Check, VerifyReport } from "@tulpar/core";
import { verifyCommand } from "../src/verify.ts";

const repo = resolve(import.meta.dirname, "../..");
const project = join(repo, "examples/carbon-angular");
const reference = join(project, "impl/modal-actions");
const ready = existsSync(join(project, "node_modules/carbon-components-angular")) && existsSync(join(repo, "out/library.json")) && existsSync(join(repo, ".cache/figma/b8xYgmx2Js30XaldxPkOs9/nodes/410-13792.json"));

type File = "ts" | "html" | "less";
const SECONDARY = `<button cdsButton="secondary" size="xl" data-figma-id="4122:87677">Button</button>`;
const PRIMARY = `<button cdsButton="primary" size="xl" data-figma-id="4122:86445">Button</button>`;

const mutants: { name: string; file: File; mutate: (s: string) => string; fails: Check["id"]; detail: RegExp; alsoPasses?: Check["id"][] }[] = [
  { name: "hard-coded hex colour in the template", file: "html", mutate: (s) => s.replace(PRIMARY, PRIMARY.replace("data-figma-id", 'style="background-color: #0f62fe" data-figma-id')), fails: "colors", detail: /#0f62fe/ },
  { name: "a plain <button> without the design system's directive", file: "html", mutate: (s) => s.replace(PRIMARY, `<button data-figma-id="4122:86445">Button</button>`), fails: "components", detail: /got <button> — invented/ },
  { name: "a hard-coded size hidden in a LESS variable", file: "less", mutate: (s) => `@gap: 24px;\n${s}\ncds-modal-footer { gap: @gap; }\n`, fails: "spacing", detail: /24px/ },
  { name: "8 px shift, made with a spacing token so only layout can catch it", file: "html", mutate: (s) => s.replace(SECONDARY, SECONDARY.replace("data-figma-id", 'style="position: relative; left: var(--cds-spacing-03, 0.5rem)" data-figma-id')), fails: "layout", detail: /x 0 → 8 \(\+8\)/, alsoPasses: ["spacing", "colors"] },
  { name: "wrong label", file: "html", mutate: (s) => s.replace(`data-figma-id="4122:86445">Button<`, `data-figma-id="4122:86445">Buton<`), fails: "text", detail: /design says "Button", rendered "Buton"/ },
  { name: "the design system's module not imported: the element never becomes a component", file: "ts", mutate: (s) => s.replace("imports: [ButtonModule, ModalModule],", "imports: [ButtonModule],\n  schemas: [CUSTOM_ELEMENTS_SCHEMA],").replace('import { Component } from "@angular/core";', 'import { CUSTOM_ELEMENTS_SCHEMA, Component } from "@angular/core";'), fails: "components", detail: /never loaded/ },
  { name: "an invented token", file: "less", mutate: (s) => `${s}\ncds-modal-footer { gap: var(--cds-border-width-01); }\n`, fails: "spacing", detail: /no such token/ },
];

async function run(name: string, edit?: { file: File; mutate: (s: string) => string }): Promise<VerifyReport> {
  const dir = join(project, ".tulpar", "mutations", name.replace(/[^a-z0-9]+/gi, "-").toLowerCase());
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  await cp(reference, dir, { recursive: true });
  if (edit) {
    const path = join(dir, `modal-actions.component.${edit.file}`);
    const before = await readFile(path, "utf8");
    const after = edit.mutate(before);
    expect(after).not.toBe(before);
    await writeFile(path, after);
  }
  const entry = join(".tulpar", "mutations", dir.split(/[\\/]/).at(-1)!, "modal-actions.component.ts").replace(/\\/g, "/");
  const { report } = await verifyCommand(project, entry, { frame: "3906:50588", out: join(repo, "out"), cache: join(repo, ".cache/figma"), quiet: true });
  return report!;
}

describe.skipIf(!ready)("verifier on the Carbon Angular modal footer", () => {
  let baseline: VerifyReport;
  beforeAll(async () => {
    baseline = await run("reference");
  }, 180_000);

  it("passes every check that runs on the reference", () => {
    expect(baseline.checks.filter((c) => c.status === "fail")).toEqual([]);
    expect(baseline.headline).toContain("3 of 3 design-system components used, 0 invented");
    expect(baseline.warnings.join()).toContain("unconfirmed");
  });

  for (const m of mutants) {
    it(`catches: ${m.name}`, async () => {
      const report = await run(m.name, m);
      expect(report.verdict).toBe("fail");
      const check = report.checks.find((c) => c.id === m.fails)!;
      expect(check.status).toBe("fail");
      expect(check.details.join("\n")).toMatch(m.detail);
      for (const id of m.alsoPasses ?? []) expect(report.checks.find((c) => c.id === id)!.status).toBe("pass");
    }, 180_000);
  }
});
