import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { AdapterError, AdapterHost, ErrorCodes, PROTOCOL_VERSION, type CodeComponent, type ComponentIndex, type TokenSet } from "@tulpar/core";
import { scanSlots } from "../src/templates.ts";

const main = resolve(import.meta.dirname, "../src/main.ts");
const fixtureRoot = resolve(import.meta.dirname, "fixtures");

// Everything below goes through the real protocol: a child process on stdio.
async function run(root: string, config: Record<string, unknown>): Promise<{ index: ComponentIndex; tokens: TokenSet }> {
  const host = await AdapterHost.start(process.execPath, [main]);
  try {
    return { index: await host.call("index", { root, config }), tokens: await host.call("tokens", { root, config }) };
  } finally {
    await host.stop();
  }
}

describe("web-components adapter on a fixture package", () => {
  let index: ComponentIndex;
  let tokens: TokenSet;
  let chip: CodeComponent;
  const prop = (name: string) => chip.props.find((p) => p.name === name)!;

  beforeAll(async () => {
    const config = (await import("./fixtures/tulpar.json", { with: { type: "json" } })).default["web-components"];
    ({ index, tokens } = await run(fixtureRoot, config));
    chip = index.components[0]!;
  });

  it("declares its capabilities honestly", async () => {
    const host = await AdapterHost.start(process.execPath, [main]);
    expect(host.manifest).toMatchObject({ id: "web-components", protocolVersion: PROTOCOL_VERSION, capabilities: { index: true, tokens: true, render: { supported: false } } });
    await expect(host.call("emit" as "index", { root: fixtureRoot, config: {} })).rejects.toMatchObject({ code: ErrorCodes.MethodNotFound });
    await host.stop();
  });

  it("reads the element from the manifest", () => {
    expect(index.package).toEqual({ name: "fixture-wc", version: "1.2.3" });
    expect(chip).toMatchObject({
      id: "fixture-wc#x-chip",
      name: "x-chip",
      exportName: "XChip",
      module: "fixture-wc/es/components/chip/chip.js",
      description: "A chip.",
    });
    expect(chip.events).toEqual([{ name: "x-chip-dismissed", description: "Fired on dismiss.", provenance: { source: "wca-manifest", confidence: "high" } }]);
  });

  it("expands enum names through the TypeScript declarations", () => {
    expect(prop("tone").type).toEqual({ kind: "enum", values: ["neutral", "danger"], open: false });
    expect(prop("tone").provenance.type?.source).toBe("ts-declarations");
    expect(prop("tone").defaultText).toBe('"neutral"');
  });

  it("keeps an enum's values when the union also accepts any string", () => {
    expect(prop("size").type).toEqual({ kind: "enum", values: ["sm", "md"], open: true });
  });

  it("reports no type for `any`, rather than a vague one", () => {
    expect(prop("extra").type).toBeUndefined();
    expect(prop("extra").typeText).toBeUndefined();
  });

  it("marks runtime API as internal, with the reason, and keeps it", () => {
    expect(prop("styles").internal).toBe("static class member, not an element prop");
    expect(prop("form").internal).toBe("read-only, no attribute");
    expect(prop("dismissible").internal).toBeUndefined();
  });

  it("keeps an attribute that has no property, typed from the manifest", () => {
    expect(prop("legacy-label")).toMatchObject({ aliases: [], type: { kind: "string" }, provenance: { type: { source: "wca-manifest" } } });
    expect(index.gaps).toContain("1 props were not found on their class; types come from the manifest only.");
  });

  it("merges declared and scanned slots, and skips dynamic names", () => {
    expect(chip.slots.map((s) => [s.name, s.provenance.source])).toEqual([
      ["icon", "wca-manifest+template-scan"],
      ["", "template-scan"],
      ["trailing", "template-scan"],
    ]);
  });

  it("reads tokens and confirms their CSS custom properties in the shipped styles", () => {
    expect(tokens.modes).toEqual(["light", "dark"]);
    const byName = Object.fromEntries(tokens.tokens.map((t) => [t.name, t]));
    expect(byName.surface).toMatchObject({ codeRef: "var(--x-surface)", codeRefConfirmed: true });
    expect(byName["space-1"]).toMatchObject({ values: { default: { kind: "dimension", points: 4 } }, codeRefConfirmed: true });
    expect(byName["space-2"]!.codeRefConfirmed).toBe(false);
    expect(tokens.gaps).toContain("1 of 3 tokens' CSS custom properties are not used by any component stylesheet; their code names are unconfirmed.");
  });

  it("says so when nothing is configured", async () => {
    const r = await run(fixtureRoot, {});
    expect(r.index.components).toEqual([]);
    expect(r.index.gaps).toEqual(['No "packages" configured; nothing to index.']);
    expect(r.tokens.gaps).toEqual(['No "tokens" configured.']);
  });
});

describe("scanSlots", () => {
  it("finds named and default slots in template text", () => {
    expect(scanSlots('<slot></slot><slot name="a"></slot><slot id="x" name=\'b\'>')).toEqual(["", "a", "b"]);
    expect(scanSlots("<slot name=${x}></slot>")).toEqual([]);
  });
});

describe("AdapterHost", () => {
  it("answers calls sent before stop, and refuses calls after it", async () => {
    const host = await AdapterHost.start(process.execPath, [main]);
    const pending = host.call("index", { root: fixtureRoot, config: {} });
    await host.stop();
    await expect(pending).resolves.toMatchObject({ adapter: "web-components" });
    await expect(host.call("index", { root: fixtureRoot, config: {} })).rejects.toBeInstanceOf(AdapterError);
  });

  it("fails fast when the adapter program cannot start", async () => {
    await expect(AdapterHost.start(process.execPath, ["-e", "process.exit(3)"])).rejects.toThrow("exited (code 3)");
  });
});

// Checks against the real pinned Carbon packages, where installed (cd examples/carbon && npm install).
const carbon = resolve(import.meta.dirname, "../../../examples/carbon");
describe.skipIf(!existsSync(resolve(carbon, "node_modules/@carbon/web-components")))("on Carbon Web Components", () => {
  let index: ComponentIndex;
  let tokens: TokenSet;
  beforeAll(async () => {
    const config = (await import("../../../examples/carbon/tulpar.json", { with: { type: "json" } })).default["web-components"];
    ({ index, tokens } = await run(carbon, config));
  }, 60_000);

  const component = (name: string) => index.components.find((c) => c.name === name)!;

  it("resolves cds-button's props, including an open enum", () => {
    const button = component("cds-button");
    const p = (n: string) => button.props.find((x) => x.name === n)!;
    expect(p("kind").type).toEqual({
      kind: "enum",
      values: ["primary", "secondary", "tertiary", "ghost", "danger", "danger-primary", "danger-tertiary", "danger-ghost"],
      open: false,
    });
    expect(p("size").type).toEqual({ kind: "enum", values: ["xs", "sm", "md", "lg", "xl", "2xl"], open: true });
    expect(button.slots.map((s) => s.name).sort()).toEqual(["", "badge-indicator", "icon"]);
  });

  it("reads Carbon's theme and layout tokens", () => {
    const t = (n: string) => tokens.tokens.find((x) => x.name === n)!;
    expect(tokens.modes).toEqual(["white", "g10", "g90", "g100"]);
    expect(t("background").values.white).toEqual({ kind: "color", color: { space: "srgb", r: 1, g: 1, b: 1, a: 1 } });
    expect(t("spacing-05")).toMatchObject({ values: { default: { kind: "dimension", points: 16 } }, codeRef: "var(--cds-spacing-05)", codeRefConfirmed: true });
  });
});

describe("Code Connect links", async () => {
  const { figmaNode, parseCodeConnect } = await import("../src/links.ts");

  it("parses Figma URLs in both forms", () => {
    expect(figmaNode("https://www.figma.com/file/ABC123/Kit?type=design&node-id=1854-1776&mode=dev")).toEqual({ fileKey: "ABC123", nodeId: "1854:1776" });
    expect(figmaNode("https://www.figma.com/design/XYZ/Kit?node-id=12%3A34")).toBeUndefined();
    expect(figmaNode("https://www.figma.com/design/XYZ/Kit?node-id=12:34")).toEqual({ fileKey: "XYZ", nodeId: "12:34" });
  });

  it("reads template files by their header", () => {
    const text = "// url=https://www.figma.com/file/K/Kit?node-id=1-2\n// source=x\n// component=x-button\nconst a = 1;";
    expect(parseCodeConnect(text, "b.figma.ts")).toEqual([
      { figma: { fileKey: "K", nodeId: "1:2" }, component: "x-button", source: "b.figma.ts", provenance: { source: "code-connect-header", confidence: "high" } },
    ]);
  });

  it("reads figma.connect calls, with their variant restriction", () => {
    const text = `import figma, { html } from '@figma/code-connect/html';
figma.connect('https://www.figma.com/design/K/Kit?node-id=5-6', {
  variant: { State: 'Skeleton', 'Has icon': true },
  example: () => html\`<x-tag-skeleton size="sm"><x-icon></x-icon></x-tag-skeleton>\`,
});
figma.connect('https://www.figma.com/design/K/Kit?node-id=5-7', { example: () => html\`<x-tag></x-tag>\` });`;
    const links = parseCodeConnect(text, "t.figma.ts");
    expect(links.map((l) => [l.figma.nodeId, l.component, l.variant])).toEqual([
      ["5:6", "x-tag-skeleton", { State: "Skeleton", "Has icon": "true" }],
      ["5:7", "x-tag", undefined],
    ]);
  });
});
