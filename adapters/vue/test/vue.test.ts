import { existsSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { CodeComponent } from "@tulpar/core";
import { indexPackage } from "../src/components.ts";
import { compileSfc } from "../src/sfc.ts";
import { analyzeVue } from "../src/verify/analyze.ts";

describe("Vue single-file components", { timeout: 60_000 }, () => {
  it("compiles <script setup> and its template into one module, with scoped styles", async () => {
    const out = await compileSfc("/x/Card.vue", `<script setup lang="ts">
import { ElButton } from "element-plus";
const label: string = "Go";
</script>
<template><div class="card"><ElButton type="primary">{{ label }}</ElButton></div></template>
<style scoped>.card { gap: var(--el-space, 8px); }</style>
`);
    expect(out.errors).toEqual([]);
    expect(out.loader).toBe("ts");
    expect(out.code).toMatch(/const _sfc_main = /);
    expect(out.code).toMatch(/_sfc_main\.__scopeId = "data-v-[0-9a-f]{8}"/);
    expect(out.code).toMatch(/export default _sfc_main/);
    // Scoping puts the component's attribute on the selector.
    expect(out.styles[0]!.css).toMatch(/\.card\[data-v-[0-9a-f]{8}\]/);
  });

  it("compiles SCSS and Less blocks, and gives a CSS Module its class map", async () => {
    const out = await compileSfc("/x/Box.vue", `<template><div :class="$style.root"><p class="t">Hi</p></div></template>
<style module>.root { display: grid; }</style>
<style scoped lang="scss">$pad: 12px; .box { .t { padding: $pad; } }</style>
<style lang="less">@gap: 4px; .row { gap: @gap; }</style>
`);
    expect(out.errors).toEqual([]);
    expect(out.styles.map((s) => s.module)).toEqual([true, false, false]);
    expect(out.styles[1]!.css).toMatch(/\.box \.t\[data-v-\w+\]\s*\{\s*padding: 12px;/);
    expect(out.styles[2]!.css).toMatch(/gap: 4px/);
    expect(out.code).toContain('"$style": style0');
    // A template-only component still gets its render function.
    expect(out.code).toMatch(/_sfc_main\.render = _sfc_render/);
  });

  it("reports a template that does not compile", async () => {
    const out = await compileSfc("/x/Bad.vue", "<template><div></template>\n");
    expect(out.errors.length).toBeGreaterThan(0);
  });
});

describe("Vue static scan", () => {
  it("finds design-system components in either case, and hard-coded values in style attributes and blocks", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tulpar-vue-"));
    await writeFile(join(dir, "Card.vue"), `<script setup>
import { ElButton, ElInput } from "element-plus";
</script>
<template>
  <div style="margin: 8px; gap: var(--el-gap, 4px)">
    <el-input placeholder="Email" />
    <ElButton>Go</ElButton>
  </div>
</template>
<style scoped lang="scss">
$c: #e0e0e0;
.card { border-color: $c; }
</style>
`);
    const a = await analyzeVue(dir, "Card.vue", "el");
    expect(a.componentsUsed.sort()).toEqual(["ElButton", "ElInput"]);
    expect(a.literals.map((l) => `${l.property} ${l.written}`)).toEqual(["margin 8px", "strokeColor #e0e0e0"]);
  });
});

const elementPlus = resolve(import.meta.dirname, "../../../examples/element-plus/node_modules/element-plus");
describe.skipIf(!existsSync(elementPlus))("index of Element Plus", () => {
  let components: CodeComponent[];
  let gaps: string[];
  beforeAll(() => {
    gaps = [];
    components = indexPackage(elementPlus, gaps).components;
  }, 120_000);
  const c = (name: string) => components.find((x) => x.name === name)!;

  it("reads components from their instances' $props, $slots and emitted events", () => {
    expect(components.length).toBeGreaterThan(80);
    expect(c("ElButton").props.find((p) => p.name === "type")!.type).toEqual({ kind: "enum", values: ["", "default", "primary", "success", "warning", "info", "text", "danger"], open: false });
    expect(c("ElButton").slots.map((s) => s.name).sort()).toEqual(["", "icon", "loading"]);
    expect(c("ElInput").events.map((e) => e.name)).toEqual(expect.arrayContaining(["update:modelValue", "change", "clear"]));
    expect(c("ElCard").slots.map((s) => s.name)).toEqual(["header", "", "footer"]);
  });

  it("omits what Vue gives every component, and says so", () => {
    expect(c("ElButton").props.map((p) => p.name)).not.toEqual(expect.arrayContaining(["key"]));
    expect(c("ElButton").props.some((p) => ["ref", "class", "style", "onVnodeMounted"].includes(p.name))).toBe(false);
    expect(gaps.join()).toMatch(/props Vue gives every component/);
  });
});
