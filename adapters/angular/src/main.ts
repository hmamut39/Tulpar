#!/usr/bin/env node
// Tulpar adapter for Angular. Speaks the adapter protocol on stdio.

import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { PROTOCOL_VERSION, serve, type ComponentIndex, type ProjectParams } from "@tulpar/core";
import { closeBrowser, closeProbeBrowser, mergeTokens, probeTokens, readTokens, render, runVitestBrowser, tokenPrefix, type RenderConfig, type TokenConfig } from "@tulpar/web-kit";
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
const prefix = (p: ProjectParams) => tokenPrefix(config(p).tokens);

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
      tests: true,
      forceStates: ["hover", "pressed", "focus"],
      themes: true,
    },
  }),

  index,

  tokens: async (params) => {
    const c = config(params);
    if (!c.tokens) return { adapter: "angular", modes: [], tokens: [], gaps: ['No "tokens" configured.'] };
    const set = readTokens(params.root, c.tokens, (c.styleDirs ?? []).map((d) => join(params.root, d)), "angular");
    if (!c.tokens.runtime) return set;
    // Tokens the library injects when the app starts (PrimeNG's theme): bootstrap an empty component with the setup's providers.
    const dir = join(params.root, ".tulpar", "probe");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "probe.component.ts"), 'import { Component } from "@angular/core";\n@Component({ selector: "tulpar-probe", standalone: true, template: "" })\nexport class ProbeComponent {}\n');
    const built = await build({ ...params, entry: ".tulpar/probe/probe.component.ts", frame: { width: 200, height: 200 } }, c.render ?? {}, c.packages ?? []);
    if (!built.ok) return { ...set, gaps: [...set.gaps, `Runtime tokens not read: the probe page did not build (${built.log.split("\n")[0]})`] };
    return mergeTokens(set, await probeTokens(built.artifact as string, c.render ?? {}, angularHooks(new Set()), c.tokens.runtime));
  },

  build: (params) => build(params, config(params).render ?? {}, config(params).packages ?? [], [...new Set(index(params).components.map((c) => c.module))]),

  render: (params) => render(params, config(params).render ?? {}, prefix(params), angularHooks(new Set(index(params).components.map((c) => c.name)))),

  analyze: (params) => analyzeAngular(params.root, params.entry, prefix(params), index(params).components),

  // Specs run in Vitest browser mode with Angular's TestBed, in JIT; the setup must live inside the project.
  test: async (params) => {
    const setup = join(params.root, ".tulpar", "vitest", "angular-setup.ts");
    await mkdir(join(params.root, ".tulpar", "vitest"), { recursive: true });
    await copyFile(join(import.meta.dirname, "verify", "vitest-setup.template.ts"), setup);
    return runVitestBrowser({
      root: params.root,
      testFile: params.entry,
      pluginImports: [`import { tulparAngular } from ${JSON.stringify(pathToFileURL(join(import.meta.dirname, "verify", "vitest-plugin.mjs")).href)};`],
      plugins: "[tulparAngular()]",
      setupFiles: [".tulpar/vitest/angular-setup.ts"],
    });
  },

  conventions: (params) => {
    const pkg = index(params).package?.name ?? "the design system";
    const styling = params.output?.styling === "scss" || params.output?.styling === "css" ? params.output.styling : "less";
    const ext = styling;
    const sheet = styling === "scss" ? "SCSS" : styling === "css" ? "CSS" : "LESS";
    const p = prefix(params);
    return {
      language: `TypeScript + HTML templates + ${sheet}`,
      framework: `Angular 22 (standalone components) with ${pkg}`,
      files: [
        { path: "{kebab}.component.ts", role: "component", description: `The standalone component class {name}Component: selector "app-{kebab}", templateUrl "./{kebab}.component.html", styleUrl "./{kebab}.component.${ext}", imports the design system's NgModules it uses.` },
        { path: "{kebab}.component.html", role: "template", description: "The template: the whole design, using the design system's elements and directives." },
        { path: `{kebab}.component.${ext}`, role: "styles", description: "Styles for the component's own layout (design-system components style themselves; only their theming CSS variables may be set, to match the design)." },
        { path: "{kebab}.component.spec.ts", role: "test", description: "Angular TestBed tests: it creates, shows the design's text, and uses the design-system components." },
      ],
      entry: "{kebab}.component.ts",
      rules: [
        "Export a standalone component class named {name}Component (standalone: true) with no required inputs.",
        `Import the design system's NgModules from their entry points, e.g. import { ButtonModule } from "${pkg}/button"; and list them in the component's imports.`,
        "Use inject() for any dependency; no constructor parameter injection.",
        "Put data-figma-id attributes directly on the design system's elements and on the native elements that carry its directives.",
        `Write every token with its value as the fallback, e.g. ${p ? `var(--${p}-…, <its value>)` : "var(--token-name, <its value>)"}: some design systems define tokens only inside their components, and without the fallback they render nothing.`,
        ...(styling === "css" ? [] : [`No ${sheet} variables for design values: use the tokens directly.`]),
        "In {kebab}.component.spec.ts use TestBed with the standalone component in imports. The specs run under Vitest with its globals (describe, it, expect, beforeEach, vi): no Jasmine-only APIs (jasmine.createSpy, toBeTrue).",
      ],
      importExample: `import { ButtonModule } from "${pkg}/button";`,
    };
  },

  shutdown: async () => {
    await closeProbeBrowser();
    await closeBrowser();
    return null;
  },
});
