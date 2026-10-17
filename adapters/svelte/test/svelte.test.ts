import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CodeComponent } from "@tulpar/core";
import { closeBrowser, render } from "@tulpar/web-kit";
import { indexPackage } from "../src/components.ts";
import { analyzeSvelte, componentsWrittenOn } from "../src/verify/analyze.ts";
import { build } from "../src/verify/build.ts";
import { svelteHooks } from "../src/verify/hooks.ts";

const example = resolve(import.meta.dirname, "../../../examples/carbon-svelte");
const carbon = join(example, "node_modules/carbon-components-svelte");

describe.skipIf(!existsSync(carbon))("Svelte adapter on Carbon for Svelte", { timeout: 120_000 }, () => {
  let components: CodeComponent[];
  const gaps: string[] = [];
  const dir = join(example, ".tulpar", "test");
  beforeAll(() => {
    components = indexPackage(carbon, gaps).components;
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "Card.svelte"),
      `<script lang="ts">\n  import { Button, Heading, TextInput } from "carbon-components-svelte";\n  let show: boolean = true;\n</script>\n\n<div class="card" data-figma-id="root" style="margin: 8px">\n  <Heading data-figma-id="e0">Sign in</Heading>\n  {#if show}<TextInput data-figma-id="e1" labelText="Email" />{/if}\n  <Button data-figma-id="e2">Go</Button>\n</div>\n\n<style>\n  .card { display: grid; gap: var(--cds-spacing-05, 16px); padding: 12px; }\n</style>\n`,
    );
  });
  afterAll(() => closeBrowser());

  it("reads components from their typed classes: props without passed-through HTML attributes, slots and events", () => {
    expect(components.length).toBeGreaterThan(200);
    const button = components.find((c) => c.name === "Button")!;
    expect(button.props.find((p) => p.name === "kind")!.type).toMatchObject({ kind: "enum", values: expect.arrayContaining(["primary", "secondary", "ghost", "danger"]) });
    expect(button.slots.map((s) => s.name).sort()).toEqual(["", "badge", "icon"]);
    expect(button.events.map((e) => e.name)).toContain("click");
    expect(button.props.some((p) => p.name === "onclick" || p.name === "aria-label")).toBe(false);
    expect(gaps.join()).toMatch(/HTML attributes components pass through were omitted/);
  });

  it("finds components (inside blocks too) and hard-coded values in the style block and attributes", async () => {
    const a = await analyzeSvelte(example, ".tulpar/test/Card.svelte", "cds");
    expect(a.componentsUsed.sort()).toEqual(["Button", "Heading", "TextInput"]);
    expect(a.literals.map((l) => `${l.property} ${l.written}`)).toEqual(["margin 8px", "padding 12px"]);
  });

  it("builds with the project's compiler, and names each element's component as the code wrote it, measured by its root", async () => {
    const config = { stylesheets: ["node_modules/carbon-components-svelte/css/all.css"] };
    const b = await build({ root: example, config: {}, entry: ".tulpar/test/Card.svelte", frame: { width: 360, height: 240 } }, config);
    expect(b.ok).toBe(true);
    const r = await render({ root: example, config: {}, artifact: b.artifact as string, entry: ".tulpar/test/Card.svelte", width: 360, height: 240, scale: 1 }, config, "cds", svelteHooks(await componentsWrittenOn(example, ".tulpar/test/Card.svelte")));
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    const byId = Object.fromEntries(r.elements.map((e) => [e.figmaId, e]));
    expect(byId.e1!.component).toBe("TextInput");
    expect(byId.e2!.component).toBe("Button");
    expect(byId.root!.component).toBe("div");
    // Heading draws its element dynamically (<svelte:element>): no runtime record, so the source tells.
    expect(byId.e0!.component).toBe("Heading");
    // TextInput puts the id on its <input>; the whole field (label included) is measured.
    expect(byId.e1!.box.height).toBeGreaterThan(50);
  });
});
