// The same promise for React: every injected defect is caught, by the right check,
// through the same core that verifies Web Components.

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { Check, VerifyReport } from "@tulpar/core";
import { verifyCommand } from "../src/verify.ts";

const repo = resolve(import.meta.dirname, "../..");
const project = join(repo, "examples/carbon-react");
const frame = "3906:50588";
const ready =
  existsSync(join(project, "node_modules/@carbon/react")) &&
  existsSync(join(repo, "out/library.json")) &&
  existsSync(join(repo, ".cache/figma/b8xYgmx2Js30XaldxPkOs9/nodes/410-13792.json"));

const PRIMARY_OPEN = `<Button kind="primary" data-figma-id="4122:86445">`;
const SECONDARY_OPEN = `<Button kind="secondary" data-figma-id="4122:87677">`;

const mutants: { name: string; mutate: (src: string) => string; fails: Check["id"]; detail: RegExp; alsoPasses?: Check["id"][]; notChecked?: Check["id"][] }[] = [
  {
    name: "hard-coded hex colour",
    mutate: (s) => s.replace(PRIMARY_OPEN, `<Button kind="primary" style={{ backgroundColor: "#0f62fe" }} data-figma-id="4122:86445">`),
    fails: "colors",
    detail: /#0f62fe/,
  },
  {
    name: "invented <button> instead of the design-system button",
    mutate: (s) => s.replace(/<Button kind="primary" data-figma-id="4122:86445">([\s\S]*?)<\/Button>/, `<button data-figma-id="4122:86445">$1</button>`),
    fails: "components",
    detail: /got <button> — invented/,
  },
  {
    name: "look-alike Button re-created with the design system's CSS classes",
    mutate: (s) =>
      s
        .replace(`import { Button, ModalFooter } from "@carbon/react";`, `import { ModalFooter } from "@carbon/react";\nfunction Button({ kind, ...rest }: any) {\n  return <button className={\`cds--btn cds--btn--\${kind}\`} {...rest} />;\n}`),
    fails: "components",
    detail: /invented/,
  },
  {
    name: "8 px shift, made with a spacing token so only layout can catch it",
    mutate: (s) => s.replace(SECONDARY_OPEN, `<Button kind="secondary" style={{ position: "relative", left: "var(--cds-spacing-03, 0.5rem)" }} data-figma-id="4122:87677">`),
    fails: "layout",
    detail: /x 0 → 8 \(\+8\)/,
    alsoPasses: ["spacing", "colors"],
  },
  {
    name: "wrong label",
    mutate: (s) => s.replace(/(data-figma-id="4122:86445">\s*)Button/, "$1Buton"),
    fails: "text",
    detail: /design says "Button", rendered "Buton"/,
  },
  {
    name: "another design-system component in the wrong place",
    mutate: (s) =>
      s
        .replace(`import { Button, ModalFooter } from "@carbon/react";`, `import { Button, ModalFooter, Tag } from "@carbon/react";`)
        .replace(/<Button kind="primary" data-figma-id="4122:86445">([\s\S]*?)<\/Button>/, `<Tag data-figma-id="4122:86445">$1</Tag>`),
    fails: "components",
    detail: /another design-system component/,
  },
  {
    name: "hard-coded font size (a plain number, which React turns into px)",
    mutate: (s) => s.replace(SECONDARY_OPEN, `<Button kind="secondary" style={{ fontSize: 16 }} data-figma-id="4122:87677">`),
    fails: "type",
    detail: /fontSize: 16px/,
  },
  {
    name: "an invented token: looks like a token, is defined nowhere",
    mutate: (s) => s.replace(SECONDARY_OPEN, `<Button kind="secondary" style={{ marginLeft: "var(--cds-border-width-01)" }} data-figma-id="4122:87677">`),
    fails: "spacing",
    detail: /no such token/,
  },
  {
    name: "a known token without its fallback, which renders nothing",
    mutate: (s) => s.replace(SECONDARY_OPEN, `<Button kind="secondary" style={{ marginLeft: "var(--cds-spacing-01)" }} data-figma-id="4122:87677">`),
    fails: "spacing",
    detail: /not defined on the page; write its fallback/,
  },
  {
    name: "misspelt import: the build fails and nothing downstream is claimed",
    mutate: (s) => s.replace(`import { Button, ModalFooter }`, `import { Buton as Button, ModalFooter }`),
    fails: "build",
    detail: /Buton/,
    notChecked: ["render", "components", "layout", "text"],
  },
];

async function run(name: string, source: string): Promise<VerifyReport> {
  const dir = join(project, ".tulpar", "mutations");
  await mkdir(dir, { recursive: true });
  const file = `${name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.tsx`;
  await writeFile(join(dir, file), source);
  const { report } = await verifyCommand(project, `.tulpar/mutations/${file}`, { frame, out: join(repo, "out"), cache: join(repo, ".cache/figma"), quiet: true });
  return report!;
}

const failing = (r: VerifyReport) => r.checks.filter((c) => c.status === "fail").map((c) => c.id);

describe.skipIf(!ready)("verifier on the Carbon React modal footer", () => {
  let reference: string;
  let baseline: VerifyReport;
  beforeAll(async () => {
    reference = await readFile(join(project, "impl/modal-footer.tsx"), "utf8");
    baseline = await run("reference", reference);
  }, 120_000);

  it("passes every check that runs on the reference, and says what it could not check", () => {
    expect(failing(baseline)).toEqual([]);
    expect(baseline.verdict).toBe("incomplete");
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
      for (const id of m.notChecked ?? []) expect(report.checks.find((c) => c.id === id)!.status).toBe("not-checked");
    }, 120_000);
  }
});
