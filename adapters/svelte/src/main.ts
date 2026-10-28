#!/usr/bin/env node
// Tulpar adapter for Svelte 5. Speaks the adapter protocol on stdio.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { PROTOCOL_VERSION, kebab, serve, type ComponentIndex, type ProjectParams } from "@tulpar/core";
import { closeBrowser, readTokens, render, runVitestBrowser, themingProperties, tokenPrefix, type RenderConfig, type TokenConfig } from "@tulpar/web-kit";
import { indexPackage } from "./components.ts";
import { readLinks } from "./links.ts";
import { analyzeSvelte, componentsWrittenOn } from "./verify/analyze.ts";
import { build } from "./verify/build.ts";
import { svelteHooks } from "./verify/hooks.ts";

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
  // Theming CSS variables from the stylesheets the render loads, where a component's class is its kebab name.
  const css = (config(params).render?.stylesheets ?? []).map((f) => (existsSync(join(params.root, f)) ? readFileSync(join(params.root, f), "utf8") : "")).join("\n");
  if (css) {
    for (const c of results.flatMap((r) => r.components)) {
      const vars = themingProperties(css, kebab(c.name));
      if (vars.length) c.cssProperties = vars.map((name) => ({ name }));
    }
  }
  const result: ComponentIndex = {
    adapter: "svelte",
    ...(results.length === 1 && { package: results[0]!.pkg }),
    components: results.flatMap((r) => r.components),
    gaps,
  };
  cachedIndex = { key, index: result };
  return result;
}

serve({
  initialize: () => ({
    id: "svelte",
    protocolVersion: PROTOCOL_VERSION,
    detects: ["package.json:svelte"],
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
      forceStates: ["hover", "pressed", "focus"],
      themes: true,
      // What it writes, its default first.
      outputs: (["typescript", "javascript"] as const).flatMap((language) => (["css", "scss", "less", "tailwind"] as const).map((styling) => ({ language, styling }))),
    },
  }),

  index,

  tokens: (params) => {
    const c = config(params);
    if (!c.tokens) return { adapter: "svelte", modes: [], tokens: [], gaps: ['No "tokens" configured.'] };
    return readTokens(params.root, c.tokens, (c.styleDirs ?? []).map((d) => join(params.root, d)), "svelte");
  },

  links: (params) => {
    const dirs = config(params).codeConnect ?? [];
    if (!dirs.length) return { adapter: "svelte", links: [], gaps: ['No "codeConnect" directories configured.'] };
    return readLinks(params.root, dirs);
  },

  build: (params) => build(params, config(params).render ?? {}, prefix(params)),

  render: async (params) => render(params, config(params).render ?? {}, prefix(params), svelteHooks(params.entry ? await componentsWrittenOn(params.root, params.entry) : {})),

  analyze: (params) => analyzeSvelte(params.root, params.entry, prefix(params)),

  // Specs run in Vitest browser mode; .svelte files are compiled by Tulpar's own plugin.
  test: (params) =>
    runVitestBrowser({
      root: params.root,
      testFile: params.entry,
      pluginImports: [`import { tulparSvelte } from ${JSON.stringify(pathToFileURL(join(import.meta.dirname, "verify", "vitest-plugin.mjs")).href)};`],
      plugins: `[tulparSvelte(${JSON.stringify(params.root.replace(/\\/g, "/"))})]`,
    }),

  conventions: (params) => {
    const pkg = index(params).package?.name ?? "the design system";
    const first = index(params).components[0]?.name ?? "Button";
    const js = params.output?.language === "javascript";
    const tailwind = params.output?.styling === "tailwind";
    // SCSS or LESS in the style block: Tulpar compiles it (lang="scss" / lang="less"), as svelte-preprocess would.
    const sheet = params.output?.styling === "scss" || params.output?.styling === "less" ? params.output.styling : undefined;
    const styleTag = sheet ? `<style lang="${sheet}">` : "<style>";
    const ext = js ? "js" : "ts";
    const p = prefix(params);
    const tokenExample = p ? `var(--${p}-…, <its value>)` : "var(--token-name, <its value>)";
    return {
      language: `Svelte 5 component, ${js ? "JavaScript" : "TypeScript"}, ${tailwind ? "Tailwind CSS" : sheet ? `scoped ${sheet.toUpperCase()}` : "scoped CSS"}`,
      framework: `Svelte 5 with ${pkg}`,
      files: [
        {
          path: "{name}.svelte",
          role: "component",
          description: `The component: <script${js ? "" : ' lang="ts"'}> and markup${tailwind ? " styled with Tailwind classes (no <style> block)" : `, and a ${styleTag} block (scoped to the component) for its own layout (design-system components style themselves; only their theming CSS variables may be set, to match the design)`}. No required props; renders the whole design.`,
        },
        { path: `{name}.test.${ext}`, role: "test", description: "Vitest tests: it mounts, shows the design's text, and uses the design-system components." },
      ],
      entry: "{name}.svelte",
      rules: [
        `Use Svelte 5 runes ($state, $props, $derived) in <script${js ? "" : ' lang="ts"'}>, and import every design-system component from "${pkg}".`,
        tailwind
          ? `Style with Tailwind utility classes in class attributes; no <style> block. Tailwind's own scale is switched off: use layout utilities as they are (flex, grid, flex-col, items-center, w-full, md:…), and write every spacing, colour, size, radius and type value as an arbitrary value with a design-system token, e.g. gap-[${tokenExample.replace(/ /g, "")}]. No inline style.`
          : `Style the component's own layout in its ${styleTag} block; Svelte scopes it to this component.${sheet ? " Nesting is fine; no hard-coded values in variables either." : ""}`,
        `Put data-figma-id directly on design-system components: they pass unknown attributes through to their element.`,
        `Fill a component's named slots or snippets the way its API declares them (children for the default content).`,
        `Write every token with its value as the fallback, e.g. ${tokenExample}: some design systems define tokens only inside their components, and without the fallback they render nothing.`,
        `In {name}.test.${ext} import { mount, flushSync } from "svelte", { describe, it, expect } from "vitest", and the component from "./{name}.svelte"; mount it into a div appended to document.body, call flushSync(), and query the DOM. ${existsSync(join(params.root, "node_modules", "@testing-library", "svelte")) ? "@testing-library/svelte is installed and may be used." : "Use document.querySelector and the DOM's own APIs: no testing library is installed (no @testing-library/dom or @testing-library/svelte)."} After an event, call flushSync() again before asserting.`,
      ],
      importExample: `import { ${first} } from "${pkg}";`,
    };
  },

  shutdown: async () => {
    await closeBrowser();
    return null;
  },
});
