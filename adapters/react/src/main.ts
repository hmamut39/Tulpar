#!/usr/bin/env node
// Tulpar adapter for React. Speaks the adapter protocol on stdio.

import { join } from "node:path";
import { PROTOCOL_VERSION, serve, type ComponentIndex, type ProjectParams } from "@tulpar/core";
import { closeBrowser, readTokens, render, type RenderConfig, type TokenConfig } from "@tulpar/web-kit";
import { indexPackage } from "./components.ts";
import { readLinks } from "./links.ts";
import { analyzeReact } from "./verify/analyze.ts";
import { build } from "./verify/build.ts";
import { reactHooks } from "./verify/hooks.ts";

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
const prefix = (p: ProjectParams) => config(p).tokens?.cssPrefix ?? "";

let cachedIndex: { key: string; index: ComponentIndex } | undefined;
function index(params: ProjectParams): ComponentIndex {
  const key = JSON.stringify([params.root, config(params).packages]);
  if (cachedIndex?.key === key) return cachedIndex.index;
  const gaps: string[] = [];
  const dirs = (config(params).packages ?? []).map((p) => join(params.root, p));
  if (!dirs.length) gaps.push('No "packages" configured; nothing to index.');
  const results = dirs.map((dir) => indexPackage(dir, gaps));
  const result: ComponentIndex = {
    adapter: "react",
    ...(results.length === 1 && { package: results[0]!.pkg }),
    components: results.flatMap((r) => r.components),
    gaps,
  };
  cachedIndex = { key, index: result };
  return result;
}

serve({
  initialize: () => ({
    id: "react",
    protocolVersion: PROTOCOL_VERSION,
    detects: ["package.json:react"],
    capabilities: {
      index: true,
      tokens: true,
      links: true,
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
    if (!c.tokens) return { adapter: "react", modes: [], tokens: [], gaps: ['No "tokens" configured.'] };
    return readTokens(params.root, c.tokens, (c.styleDirs ?? []).map((d) => join(params.root, d)), "react");
  },

  links: (params) => {
    const dirs = config(params).codeConnect ?? [];
    if (!dirs.length) return { adapter: "react", links: [], gaps: ['No "codeConnect" directories configured.'] };
    return readLinks(params.root, dirs);
  },

  build: (params) => build(params, config(params).render ?? {}, config(params).packages ?? []),

  // Identifying components needs the index's names, to find the design-system component in a wrapper chain.
  render: (params) => render(params, config(params).render ?? {}, prefix(params), reactHooks(new Set(index(params).components.map((c) => c.name)))),

  analyze: (params) => analyzeReact(params.root, params.entry, prefix(params)),

  shutdown: async () => {
    await closeBrowser();
    return null;
  },
});
