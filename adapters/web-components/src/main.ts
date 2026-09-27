#!/usr/bin/env node
// Tulpar adapter for Web Components. Speaks the adapter protocol on stdio.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PROTOCOL_VERSION, serve, type ComponentIndex, type ProjectParams } from "@tulpar/core";
import { indexPackage } from "./components.ts";
import { readLinks } from "./links.ts";
import { closeBrowser, readTokens, render, type RenderConfig, type TokenConfig } from "@tulpar/web-kit";
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

const prefix = (config: Record<string, unknown>) => (config as Config).tokens?.cssPrefix ?? "";

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

  tokens: (params) => {
    const config = (params.config as Config).tokens;
    if (!config) return { adapter: "web-components", modes: [], tokens: [], gaps: ['No "tokens" configured.'] };
    return readTokens(params.root, config, packageDirs(params), "web-components");
  },

  build: (params) => build(params, (params.config as Config).render ?? {}),

  render: (params) => render(params, (params.config as Config).render ?? {}, prefix(params.config), webComponentHooks),

  analyze: (params) => {
    const impl = parseImplementation(readFileSync(join(params.root, params.entry), "utf8"));
    return analyzeImplementation(impl, params.entry, prefix(params.config));
  },

  shutdown: async () => {
    await closeBrowser();
    return null;
  },

  links: (params) => {
    const dirs = (params.config as Config).codeConnect ?? [];
    if (!dirs.length) return { adapter: "web-components", links: [], gaps: ['No "codeConnect" directories configured.'] };
    return readLinks(params.root, dirs);
  },
});
