#!/usr/bin/env node
// Tulpar adapter for Web Components. Speaks the adapter protocol on stdio.

import { join } from "node:path";
import { PROTOCOL_VERSION, serve, type ComponentIndex, type ProjectParams } from "@tulpar/core";
import { indexPackage } from "./components.ts";
import { readLinks } from "./links.ts";
import { readTokens, type TokenConfig } from "./tokens.ts";

interface Config {
  packages?: string[];
  tokens?: TokenConfig;
  /** Directories holding Code Connect files, relative to the project root. */
  codeConnect?: string[];
}

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
      build: false,
      render: { supported: false, hostOS: ["linux", "windows", "macos"], reason: "rendering arrives in step 4" },
      runtimeStyleProvenance: false,
      staticProvenance: false,
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
    return readTokens(params.root, config, packageDirs(params));
  },

  links: (params) => {
    const dirs = (params.config as Config).codeConnect ?? [];
    if (!dirs.length) return { adapter: "web-components", links: [], gaps: ['No "codeConnect" directories configured.'] };
    return readLinks(params.root, dirs);
  },
});
