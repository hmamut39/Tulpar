// tulpar check: hard-coded values and invented tokens in component code, with no model and no design.

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { checkCommand } from "../src/check.ts";

const radix = resolve(import.meta.dirname, "../../examples/radix");
const dir = join(radix, "check-fixture");

describe.skipIf(!existsSync(join(radix, "node_modules/@radix-ui/themes")))("tulpar check", { timeout: 120_000 }, () => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "Card.tsx"), 'import { Button } from "@radix-ui/themes";\nimport "./Card.css";\nexport default function Card() {\n  return <div className="card" style={{ color: "#ff00ff" }}><Button>Go</Button></div>;\n}\n');
  writeFileSync(join(dir, "Card.css"), ".card {\n  padding: 13px;\n  gap: var(--space-3, 12px);\n  margin: var(--space-33, 4px);\n  --card-gap: 8px;\n  row-gap: var(--card-gap);\n}\n");
  writeFileSync(join(dir, "Clean.tsx"), 'import { Button } from "@radix-ui/themes";\nexport default function Clean() {\n  return <Button size="2">Go</Button>;\n}\n');
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("finds hard-coded values and invented tokens, on their lines, from a changed stylesheet or component", async () => {
    const { code, findings } = await checkCommand(radix, [join(dir, "Card.css")], { quiet: true });
    expect(code).toBe(1);
    expect(findings.map((f) => `${f.kind} ${f.file.split("/").pop()}:${f.line}`).sort()).toEqual(["hard-coded Card.css:2", "hard-coded Card.tsx:4", "invented-token Card.css:4"]);
    // A real token and a variable the component declares itself are fine.
    expect(findings.some((f) => /space-3[^3]|card-gap/.test(f.message))).toBe(false);
  });

  it("passes a component written with the design system", async () => {
    expect((await checkCommand(radix, [join(dir, "Clean.tsx")], { quiet: true })).code).toBe(0);
  });
});
