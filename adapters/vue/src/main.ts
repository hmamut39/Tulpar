#!/usr/bin/env node
// Tulpar adapter for Vue 3. Speaks the adapter protocol on stdio.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { PROTOCOL_VERSION, kebab, serve, type ComponentIndex, type ProjectParams } from "@tulpar/core";
import { closeBrowser, closeProbeBrowser, mergeTokens, probeTokens, readTokens, render, runVitestBrowser, themingProperties, tokenPrefix, type RenderConfig, type TokenConfig } from "@tulpar/web-kit";
import { indexPackage } from "./components.ts";
import { readLinks } from "./links.ts";
import { analyzeVue } from "./verify/analyze.ts";
import { build } from "./verify/build.ts";
import { vueHooks } from "./verify/hooks.ts";

interface Config {
  /** Component packages, relative to the project root. */
  packages?: string[];
  tokens?: TokenConfig;
  /** Directories whose stylesheets show which token CSS variables code uses. */
  styleDirs?: string[];
  codeConnect?: string[];
  render?: RenderConfig;
}

const config = (p: ProjectParams) => p.config as Config;
const prefix = (p: ProjectParams) => tokenPrefix(config(p).tokens);

let cachedIndex: { key: string; index: ComponentIndex } | undefined;
function index(params: ProjectParams): ComponentIndex {
  const key = JSON.stringify([params.root, config(params).packages]);
  if (cachedIndex?.key === key) return cachedIndex.index;
  const gaps: string[] = [];
  const dirs = (config(params).packages ?? []).map((p) => join(params.root, p));
  if (!dirs.length) gaps.push('No "packages" configured; nothing to index.');
  const results = dirs.map((dir) => indexPackage(dir, gaps));
  // Theming CSS variables from the stylesheets the render loads: ElButton reads --el-button-*, declared on .el-button.
  const css = (config(params).render?.stylesheets ?? []).map((f) => (existsSync(join(params.root, f)) ? readFileSync(join(params.root, f), "utf8") : "")).join("\n");
  if (css) {
    for (const c of results.flatMap((r) => r.components)) {
      const vars = themingProperties(css, kebab(c.name));
      if (vars.length) c.cssProperties = vars.map((name) => ({ name }));
    }
  }
  const result: ComponentIndex = {
    adapter: "vue",
    ...(results.length === 1 && { package: results[0]!.pkg }),
    components: results.flatMap((r) => r.components),
    gaps,
  };
  cachedIndex = { key, index: result };
  return result;
}

serve({
  initialize: () => ({
    id: "vue",
    protocolVersion: PROTOCOL_VERSION,
    detects: ["package.json:vue"],
    capabilities: {
      index: true,
      tokens: true,
      links: true,
      emit: false,
      build: true,
      render: { supported: true, hostOS: ["linux", "windows", "macos"] },
      runtimeStyleProvenance: true,
      staticProvenance: true,
      tests: true,
      forceStates: [],
      themes: true,
    },
  }),

  index,

  tokens: async (params) => {
    const c = config(params);
    if (!c.tokens) return { adapter: "vue", modes: [], tokens: [], gaps: ['No "tokens" configured.'] };
    const set = readTokens(params.root, c.tokens, (c.styleDirs ?? []).map((d) => join(params.root, d)), "vue");
    if (!c.tokens.runtime) return set;
    // Tokens the library injects when it is installed (Vuetify's theme): render an empty component with the setup and read them.
    const dir = join(params.root, ".tulpar", "probe");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "Probe.vue"), "<template><div /></template>\n");
    const built = await build({ ...params, entry: ".tulpar/probe/Probe.vue", frame: { width: 200, height: 200 } }, c.render ?? {}, c.packages ?? []);
    if (!built.ok) return { ...set, gaps: [...set.gaps, `Runtime tokens not read: the probe page did not build (${built.log.split("\n")[0]})`] };
    return mergeTokens(set, await probeTokens(built.artifact as string, c.render ?? {}, vueHooks(new Set()), c.tokens.runtime));
  },

  links: (params) => {
    const dirs = config(params).codeConnect ?? [];
    if (!dirs.length) return { adapter: "vue", links: [], gaps: ['No "codeConnect" directories configured.'] };
    return readLinks(params.root, dirs);
  },

  build: (params) => build(params, config(params).render ?? {}, config(params).packages ?? [], prefix(params)),

  render: (params) => render(params, config(params).render ?? {}, prefix(params), vueHooks(new Set(index(params).components.map((c) => c.name)))),

  analyze: (params) => analyzeVue(params.root, params.entry, prefix(params)),

  // Specs run in Vitest browser mode; .vue files are compiled by Tulpar's own plugin.
  test: (params) =>
    runVitestBrowser({
      root: params.root,
      testFile: params.entry,
      pluginImports: [`import { tulparVue } from ${JSON.stringify(pathToFileURL(join(import.meta.dirname, "verify", "vitest-plugin.mjs")).href)};`],
      plugins: "[tulparVue()]",
    }),

  conventions: (params) => {
    const pkg = index(params).package?.name ?? "the design system";
    const first = index(params).components[0]?.name ?? "Button";
    // The team's language and styling: TypeScript or JavaScript; scoped CSS, SCSS, Less, a CSS Module or Tailwind.
    const js = params.output?.language === "javascript";
    const styling = params.output?.styling === "css-modules" || params.output?.styling === "scss" || params.output?.styling === "less" || params.output?.styling === "tailwind" ? params.output.styling : "css";
    const styleTag = styling === "css-modules" ? "<style module>" : styling === "scss" ? '<style scoped lang="scss">' : styling === "less" ? '<style scoped lang="less">' : "<style scoped>";
    const sheet = styling === "tailwind" ? "Tailwind CSS" : styling === "css-modules" ? "CSS Modules" : styling === "scss" ? "SCSS" : styling === "less" ? "Less" : "scoped CSS";
    const ext = js ? "js" : "ts";
    // @vue/test-utils when the team has it; otherwise Vue itself mounts the component.
    const testUtils = existsSync(join(params.root, "node_modules", "@vue", "test-utils"));
    const p = prefix(params);
    const tokenExample = p ? `var(--${p}-…,<its value>)` : "var(--token-name,<its value>)";
    return {
      language: `Vue single-file component, ${js ? "JavaScript" : "TypeScript"}, ${sheet}`,
      framework: `Vue 3 with ${pkg}`,
      files: [
        {
          path: "{name}.vue",
          role: "component",
          description: `The component: <script setup${js ? "" : ' lang="ts"'}>, <template>${styling === "tailwind" ? " styled with Tailwind classes (no <style> block)" : `, and ${styleTag} for its own layout (design-system components style themselves; only their theming CSS variables may be set, to match the design)`}. No required props; renders the whole design.`,
        },
        { path: `{name}.test.${ext}`, role: "test", description: `Vitest tests: it mounts, shows the design's text, and uses the design-system components.` },
      ],
      entry: "{name}.vue",
      rules: [
        `Use <script setup${js ? "" : ' lang="ts"'}> and import every design-system component explicitly from "${pkg}" (no global registration).`,
        styling === "tailwind"
          ? `Style with Tailwind utility classes in class attributes; no <style> block. Tailwind's own scale is switched off: use layout utilities as they are (flex, grid, flex-col, items-center, justify-between, w-full, md:…), and write every spacing, colour, size, radius and type value as an arbitrary value with a design-system token, e.g. gap-[${tokenExample}] or bg-[${tokenExample}]. Classes such as p-4, text-sm or bg-blue-500 draw nothing here. No inline style.`
          : styling === "css-modules"
          ? `Style with <style module> and bind classes from $style, e.g. :class="$style.root"; class names in the block are local.`
          : `Style with ${styleTag}.${styling === "scss" || styling === "less" ? " Nesting is fine; no hard-coded values in variables either." : ""}`,
        `Put data-figma-id directly on design-system components: Vue passes it through to their root element.`,
        `Fill a component's named slots with <template #name>, and bind values with v-model where the component has one (modelValue).`,
        `Write every token with its value as the fallback, e.g. ${p ? `var(--${p}-…, <its value>)` : "var(--token-name, <its value>)"}: some design systems define tokens only inside their components, and without the fallback they render nothing.`,
        testUtils
          ? `In {name}.test.${ext} import { mount } from "@vue/test-utils", { describe, it, expect } from "vitest", and the component from "./{name}.vue"; use attachTo: document.body.`
          : `In {name}.test.${ext} import { createApp } from "vue", { describe, it, expect } from "vitest", and the component from "./{name}.vue"; mount it into a div appended to document.body, and query the DOM.`,
      ],
      importExample: `import { ${first} } from "${pkg}";`,
    };
  },

  shutdown: async () => {
    await closeProbeBrowser();
    await closeBrowser();
    return null;
  },
});
