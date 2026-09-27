#!/usr/bin/env node
// Tulpar adapter for Angular. Speaks the adapter protocol on stdio.

import { join } from "node:path";
import { PROTOCOL_VERSION, serve, type ComponentIndex, type ProjectParams } from "@tulpar/core";
import { closeBrowser, readTokens, render, type RenderConfig, type TokenConfig } from "@tulpar/web-kit";
import { indexPackage } from "./components.ts";
import { analyzeAngular } from "./verify/analyze.ts";
import { build } from "./verify/build.ts";
import { angularHooks } from "./verify/hooks.ts";

interface Config {
  packages?: string[];
  tokens?: TokenConfig;
  styleDirs?: string[];
  render?: RenderConfig;
}

const config = (p: ProjectParams) => p.config as Config;
const prefix = (p: ProjectParams) => config(p).tokens?.cssPrefix ?? "";

let cached: { key: string; index: ComponentIndex } | undefined;
function index(params: ProjectParams): ComponentIndex {
  const key = JSON.stringify([params.root, config(params).packages]);
  if (cached?.key === key) return cached.index;
  const gaps: string[] = [];
  const dirs = (config(params).packages ?? []).map((p) => join(params.root, p));
  if (!dirs.length) gaps.push('No "packages" configured; nothing to index.');
  const results = dirs.map((dir) => indexPackage(dir, gaps));
  const result: ComponentIndex = { adapter: "angular", ...(results.length === 1 && { package: results[0]!.pkg }), components: results.flatMap((r) => r.components), gaps };
  cached = { key, index: result };
  return result;
}

serve({
  initialize: () => ({
    id: "angular",
    protocolVersion: PROTOCOL_VERSION,
    detects: ["package.json:@angular/core"],
    capabilities: {
      index: true,
      tokens: true,
      // No Code Connect files exist for this design system's Angular package.
      links: false,
      emit: false,
      build: true,
      render: { supported: true, hostOS: ["linux", "windows", "macos"] },
      runtimeStyleProvenance: true,
      staticProvenance: true,
      forceStates: [],
      themes: true,
    },
  }),

  index,

  tokens: (params) => {
    const c = config(params);
    if (!c.tokens) return { adapter: "angular", modes: [], tokens: [], gaps: ['No "tokens" configured.'] };
    return readTokens(params.root, c.tokens, (c.styleDirs ?? []).map((d) => join(params.root, d)), "angular");
  },

  build: (params) => build(params, config(params).render ?? {}, config(params).packages ?? []),

  render: (params) => render(params, config(params).render ?? {}, prefix(params), angularHooks(new Set(index(params).components.map((c) => c.name)))),

  analyze: (params) => analyzeAngular(params.root, params.entry, prefix(params), index(params).components),

  conventions: (params) => {
    const pkg = index(params).package?.name ?? "the design system";
    return {
      language: "TypeScript + HTML templates + LESS",
      framework: `Angular 22 (standalone components) with ${pkg}`,
      files: [
        { path: "{kebab}.component.ts", role: "component", description: "The standalone component class {name}Component: selector \"app-{kebab}\", templateUrl \"./{kebab}.component.html\", styleUrl \"./{kebab}.component.less\", imports the design system's NgModules it uses." },
        { path: "{kebab}.component.html", role: "template", description: "The template: the whole design, using the design system's elements and directives." },
        { path: "{kebab}.component.less", role: "styles", description: "Styles for the component's own layout only (design-system components style themselves)." },
        { path: "{kebab}.component.spec.ts", role: "test", description: "Angular TestBed tests: it creates, shows the design's text, and uses the design-system components." },
      ],
      entry: "{kebab}.component.ts",
      rules: [
        "Export a standalone component class named {name}Component (standalone: true) with no required inputs.",
        `Import the design system's NgModules from their entry points, e.g. import { ButtonModule } from "${pkg}/button"; and list them in the component's imports.`,
        "Use inject() for any dependency; no constructor parameter injection.",
        "Put data-figma-id attributes directly on the design system's elements and on the native elements that carry its directives (e.g. <button cdsButton=\"primary\" data-figma-id=\"…\">).",
        "Write every token with its value as the fallback, the way the design system's own styles do: var(--cds-spacing-05, 1rem), var(--cds-layer-01, #f4f4f4). Spacing tokens are not global variables, so without the fallback they render nothing.",
        "No LESS variables for design values: use the tokens directly.",
        "In {kebab}.component.spec.ts use TestBed with the standalone component in imports.",
      ],
      importExample: `import { ButtonModule } from "${pkg}/button";`,
    };
  },

  shutdown: async () => {
    await closeBrowser();
    return null;
  },
});
