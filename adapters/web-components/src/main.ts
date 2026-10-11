#!/usr/bin/env node
// Tulpar adapter for Web Components. Speaks the adapter protocol on stdio.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PROTOCOL_VERSION, serve, type ComponentIndex, type ProjectParams } from "@tulpar/core";
import { exampleImport, indexPackage } from "./components.ts";
import { readLinks } from "./links.ts";
import { closeBrowser, closeProbeBrowser, mergeTokens, probeTokens, readTokens, render, type RenderConfig, type TokenConfig } from "@tulpar/web-kit";
import { build } from "./verify/build.ts";
import { webComponentHooks } from "./verify/hooks.ts";
import { analyzeImplementation, parseImplementation } from "./verify/impl.ts";

interface Config {
  packages?: string[];
  tokens?: TokenConfig;
  /** Directories holding Code Connect files, relative to the project root. */
  codeConnect?: string[];
  render?: RenderConfig;
}

const prefix = (config: Record<string, unknown>) => (config as Config).tokens?.cssPrefix ?? (config as Config).tokens?.css?.prefix ?? "";

const packageDirs = ({ root, config }: ProjectParams) => ((config as Config).packages ?? []).map((p) => join(root, p));

serve({
  initialize: () => ({
    id: "web-components",
    protocolVersion: PROTOCOL_VERSION,
    detects: ["package.json:customElements", "custom-elements.json"],
    capabilities: {
      index: true,
      tokens: true,
      links: true,
      // Not built yet; declared honestly so the core reports "not checked".
      emit: false,
      build: true,
      render: { supported: true, hostOS: ["linux", "windows", "macos"] },
      runtimeStyleProvenance: true,
      staticProvenance: true,
      forceStates: [],
      themes: true,
    },
  }),

  index: (params): ComponentIndex => {
    const gaps: string[] = [];
    const dirs = packageDirs(params);
    if (!dirs.length) gaps.push('No "packages" configured; nothing to index.');
    const results = dirs.map((dir) => indexPackage(dir, gaps));
    return {
      adapter: "web-components",
      ...(results.length === 1 && { package: results[0]!.pkg }),
      components: results.flatMap((r) => r.components),
      gaps,
    };
  },

  tokens: async (params) => {
    const config = (params.config as Config).tokens;
    if (!config) return { adapter: "web-components", modes: [], tokens: [], gaps: ['No "tokens" configured.'] };
    const set = readTokens(params.root, config, packageDirs(params), "web-components");
    if (!config.runtime) return set;
    // Tokens a library sets when its setup runs (Fluent's setTheme): an empty page with the setup, read back.
    const dir = join(params.root, ".tulpar", "probe");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "probe.html"), "<div></div>\n");
    const render = (params.config as Config).render ?? {};
    const built = await build({ ...params, entry: ".tulpar/probe/probe.html", frame: { width: 200, height: 200 } }, render);
    if (!built.ok) return { ...set, gaps: [...set.gaps, `Runtime tokens not read: the probe page did not build (${built.log.split("\n")[0]})`] };
    return mergeTokens(set, await probeTokens(built.artifact as string, render, webComponentHooks, config.runtime));
  },

  build: (params) => build(params, (params.config as Config).render ?? {}),

  render: (params) => render(params, (params.config as Config).render ?? {}, prefix(params.config), webComponentHooks),

  analyze: (params) => {
    const impl = parseImplementation(readFileSync(join(params.root, params.entry), "utf8"));
    return analyzeImplementation(impl, params.entry, prefix(params.config));
  },

  conventions: (params) => {
    const dir = packageDirs(params)[0] ?? params.root;
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).name as string;
    // The import path and token names come from this design system, never from another one.
    const importLine = `import "${exampleImport(dir, pkg)}";`;
    const p = prefix(params.config);
    const tokenExample = p ? `var(--${p}-…, <its value>)` : "var(--token-name, <its value>)";
    return {
      language: "HTML, CSS and JavaScript modules",
      framework: `Web Components (${pkg})`,
      files: [{ path: "{name}.html", role: "component", description: "One HTML file: a <script type=\"module\"> that imports the design-system elements it uses, a <style> block for the component's own layout, and the markup." }],
      entry: "{name}.html",
      rules: [
        `Import each design-system element from its own module, the way the component list gives it, e.g. ${importLine}`,
        "Use the design-system custom elements (their tag names) for every mapped instance; set their attributes as the mapping gives them (kebab-case attribute names).",
        "Put data-figma-id attributes directly on the custom elements.",
        `Write every token with its value as the fallback, e.g. ${tokenExample}: some design systems define tokens only inside their components, and without the fallback they render nothing.`,
        "Use only static imports at the top of the module script; no top-level await or dynamic import().",
      ],
      importExample: importLine,
    };
  },

  shutdown: async () => {
    await closeProbeBrowser();
    await closeBrowser();
    return null;
  },

  links: (params) => {
    const dirs = (params.config as Config).codeConnect ?? [];
    if (!dirs.length) return { adapter: "web-components", links: [], gaps: ['No "codeConnect" directories configured.'] };
    return readLinks(params.root, dirs);
  },
});
