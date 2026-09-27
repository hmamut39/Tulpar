import { existsSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { CodeComponent } from "@tulpar/core";
import { indexPackage } from "../src/components.ts";
import { parseCodeConnect } from "../src/links.ts";
import { analyzeReact } from "../src/verify/analyze.ts";

describe("React Code Connect links", () => {
  it("takes the component from figma.connect's first argument", () => {
    const text = `import figma from '@figma/code-connect';
import { Tag, DismissibleTag } from '@carbon/react';
figma.connect(Tag, 'https://www.figma.com/design/K/Kit?node-id=16031-269750', { variant: { Type: 'Read-only' }, example: () => <Tag /> });
figma.connect(DismissibleTag, 'https://www.figma.com/design/K/Kit?node-id=16031-269751', { example: () => <DismissibleTag /> });`;
    expect(parseCodeConnect(text, "Tag.figma.tsx").map((l) => [l.figma.nodeId, l.component, l.variant])).toEqual([
      ["16031:269750", "Tag", { Type: "Read-only" }],
      ["16031:269751", "DismissibleTag", undefined],
    ]);
  });

  it("reads template files by their header", () => {
    const text = "// url=https://www.figma.com/design/K/Kit?node-id=3906-50587\n// component=ModalFooter\nexport default {};";
    expect(parseCodeConnect(text, "ModalFooter.figma.ts")).toMatchObject([{ figma: { nodeId: "3906:50587" }, component: "ModalFooter" }]);
  });

  it("ignores calls that are commented out", () => {
    expect(parseCodeConnect("// figma.connect(\n//   'https://www.figma.com/design/K/Kit?node-id=1-2',\n// )", "x.figma.tsx")).toEqual([]);
  });
});

describe("React static scan", () => {
  it("finds design-system components and hard-coded values in style objects and imported CSS", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tulpar-react-"));
    await writeFile(join(dir, "card.css"), ".card {\n  padding: var(--cds-spacing-05);\n  border-color: #e0e0e0;\n}\n");
    await writeFile(
      join(dir, "card.tsx"),
      `import "./card.css";
import { Button, Tile } from "@carbon/react";
export default () => (
  <Tile style={{ marginTop: 8, color: "var(--cds-text-primary)", padding: 0 }}>
    <Button style={{ backgroundColor: "#0f62fe" }}>Go</Button>
    <div style={{ gap: someValue }} />
  </Tile>
);`,
    );
    const a = analyzeReact(dir, "card.tsx", "cds");
    expect(a.componentsUsed.sort()).toEqual(["Button", "Tile"]);
    expect(a.literals.map((l) => `${l.property} ${l.written} ${l.at}`)).toEqual(["strokeColor #e0e0e0 card.css:3", "margin 8px card.tsx:4", "fill #0f62fe card.tsx:5"]);
  });
});

const carbon = resolve(import.meta.dirname, "../../../examples/carbon-react/node_modules/@carbon/react");
describe.skipIf(!existsSync(carbon))("index of Carbon React", () => {
  let components: CodeComponent[];
  let gaps: string[];
  beforeAll(() => {
    gaps = [];
    components = indexPackage(carbon, gaps).components;
  }, 120_000);
  const c = (name: string) => components.find((x) => x.name === name)!;
  const p = (comp: string, name: string) => c(comp).props.find((x) => x.name === name)!;

  it("reads polymorphic components, whose return type reads as any", () => {
    expect(p("Button", "kind").type).toEqual({ kind: "enum", values: ["primary", "secondary", "danger", "ghost", "danger--primary", "danger--ghost", "danger--tertiary", "tertiary"], open: false });
    expect(p("Button", "size").type).toEqual({ kind: "enum", values: ["xs", "sm", "md", "lg", "xl", "2xl"], open: false });
    expect(c("Button").slots.map((s) => s.name).sort()).toEqual(["", "renderIcon"]);
  });

  it("reads every member of a union of prop shapes", () => {
    expect(c("Tag").props.map((x) => x.name)).toEqual(expect.arrayContaining(["type", "size", "selected", "dismissTooltipLabel"]));
    expect(c("Tag").events.map((e) => e.name).sort()).toEqual(["onChange", "onClick", "onClose"]);
  });

  it("recovers props hidden by polymorphic typing, and says so", () => {
    expect(p("DismissibleTag", "type").type).toMatchObject({ kind: "enum" });
    expect(p("DismissibleTag", "type").provenance.name).toMatchObject({ confidence: "medium" });
    expect(c("DismissibleTag").props.some((x) => x.name === "innerHTML" || x.name === "onclick")).toBe(false);
    expect(gaps.join()).toMatch(/components' props were read from a type argument/);
  });

  it("keeps React plumbing as internal props and omits inherited DOM attributes", () => {
    expect(p("Button", "as").internal).toBe("polymorphic element override");
    expect(c("Button").props.some((x) => x.name === "onClick" || x.name === "aria-label" || x.name === "className")).toBe(false);
  });
});
