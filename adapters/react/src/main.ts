#!/usr/bin/env node
// Tulpar adapter for React. Speaks the adapter protocol on stdio.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PROTOCOL_VERSION, serve, type ComponentIndex, type ProjectParams } from "@tulpar/core";
import { closeBrowser, closeProbeBrowser, mergeTokens, probeTokens, readTokens, render, runVitestBrowser, tokenPrefix, type RenderConfig, type TokenConfig } from "@tulpar/web-kit";
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
const prefix = (p: ProjectParams) => tokenPrefix(config(p).tokens);

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
      tests: true,
      forceStates: ["hover", "pressed", "focus"],
      themes: true,
      // What it writes, its default first.
      outputs: (["typescript", "javascript"] as const).flatMap((language) => (["css", "css-modules", "scss", "less", "tailwind", "styled-components", "emotion"] as const).map((styling) => ({ language, styling }))),
    },
  }),

  index,

  tokens: async (params) => {
    const c = config(params);
    if (!c.tokens) return { adapter: "react", modes: [], tokens: [], gaps: ['No "tokens" configured.'] };
    const set = readTokens(params.root, c.tokens, (c.styleDirs ?? []).map((d) => join(params.root, d)), "react");
    if (!c.tokens.runtime) return set;
    // Tokens the library injects when its provider starts: render an empty component with the setup and read them.
    const dir = join(params.root, ".tulpar", "probe");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "Probe.tsx"), "export default function Probe() { return null; }\n");
    const built = await build({ ...params, entry: ".tulpar/probe/Probe.tsx", frame: { width: 200, height: 200 } }, c.render ?? {}, c.packages ?? []);
    if (!built.ok) return { ...set, gaps: [...set.gaps, `Runtime tokens not read: the probe page did not build (${built.log.split("\n")[0]})`] };
    return mergeTokens(set, await probeTokens(built.artifact as string, c.render ?? {}, reactHooks(new Set()), c.tokens.runtime));
  },

  links: (params) => {
    const dirs = config(params).codeConnect ?? [];
    if (!dirs.length) return { adapter: "react", links: [], gaps: ['No "codeConnect" directories configured.'] };
    return readLinks(params.root, dirs);
  },

  build: (params) => build(params, config(params).render ?? {}, config(params).packages ?? [], prefix(params)),

  // Identifying components needs the index's names, to find the design-system component in a wrapper chain.
  render: (params) => render(params, config(params).render ?? {}, prefix(params), reactHooks(new Set(index(params).components.map((c) => c.name)))),

  analyze: (params) => analyzeReact(params.root, params.entry, prefix(params)),

  test: (params) => runVitestBrowser({ root: params.root, testFile: params.entry, fallbackModules: ["styled-components", "@emotion/react", "@emotion/styled"] }),

  conventions: (params) => {
    const pkg = index(params).package?.name ?? "the design system";
    // The team's language and styling: TypeScript or JavaScript; plain CSS, CSS Modules, SCSS, LESS, Tailwind, styled-components or Emotion.
    const js = params.output?.language === "javascript";
    const chosen = params.output?.styling;
    const styling = chosen === "css-modules" || chosen === "scss" || chosen === "less" || chosen === "tailwind" || chosen === "styled-components" || chosen === "emotion" ? chosen : "css";
    const cssInJs = styling === "styled-components" || styling === "emotion";
    const library = styling === "emotion" ? "@emotion/styled" : "styled-components";
    const p = prefix(params);
    const tokenExample = p ? `var(--${p}-…, <its value>)` : "var(--token-name, <its value>)";
    const ext = js ? "jsx" : "tsx";
    const styleFile = cssInJs ? `{name}.styles.${js ? "js" : "ts"}` : styling === "css-modules" ? "{name}.module.css" : styling === "scss" ? "{name}.scss" : styling === "less" ? "{name}.less" : "{name}.css";
    const styleRule = cssInJs
      ? `Style with ${styling === "emotion" ? "Emotion" : "styled-components"}: in {name}.styles.${js ? "js" : "ts"}, import styled from "${library}" and export the styled elements (export const Root = styled.div\`…\`), and use them in {name}.${ext}. Use template literals with tokens and their fallbacks, e.g. gap: ${tokenExample}; no hard-coded values, in interpolations either. A design-system component may be wrapped (styled(Button)) for its layout around it (margins, alignment) or its theming CSS variables only. Props that only drive styles start with $ (transient props), so they never reach the DOM.`
      : styling === "tailwind"
        ? `Style with Tailwind utility classes in className; there is no stylesheet. Tailwind's own scale is switched off: use layout utilities as they are (flex, grid, flex-col, items-center, justify-between, w-full, md:…), and write every spacing, colour, size, radius and type value as an arbitrary value with a design-system token, e.g. gap-[${tokenExample.replace(/ /g, "")}] or bg-[${tokenExample.replace(/ /g, "")}]. Classes such as p-4, text-sm or bg-blue-500 draw nothing here. No style={{}}.`
        : styling === "css-modules"
        ? `Import the styles as a CSS Module: import styles from "./{name}.module.css", and use className={styles.root} and so on; class names in the file are local.`
        : `Import "./${styleFile}" from {name}.${ext}.`;
    return {
      language: `${js ? "JavaScript (JSX)" : "TypeScript (TSX)"}, ${styling === "styled-components" ? "styled-components" : styling === "emotion" ? "Emotion (@emotion/styled)" : styling === "tailwind" ? "Tailwind CSS" : styling === "css-modules" ? "CSS Modules" : styling === "scss" ? "SCSS" : styling === "less" ? "LESS" : "CSS"}`,
      framework: `React 19 with ${pkg}`,
      files: [
        { path: `{name}.${ext}`, role: "component", description: `The component, default-exported, with no required props; renders the whole design.${js ? " Plain JavaScript: no type annotations." : ""}` },
        ...(styling === "tailwind" ? [] : [{ path: styleFile, role: "styles" as const, description: `${cssInJs ? `The styled elements, written with ${library}, for` : "Styles for"} the component's own layout (design-system components style themselves; only their theming CSS variables may be set, to match the design), imported by {name}.${ext}.${styling === "scss" || styling === "less" ? ` ${styling === "scss" ? "SCSS" : "LESS"}: nesting is fine; no hard-coded values in variables either.` : ""}` }]),
        { path: `{name}.test.${ext}`, role: "test", description: "Vitest + @testing-library/react tests: it renders, shows the design's text, and uses the design-system components." },
      ],
      entry: `{name}.${ext}`,
      rules: [
        "Default-export a function component named {name} with no required props.",
        styleRule,
        `Design-system components pass unknown props such as data-figma-id through to their root element; put data-figma-id directly on them.`,
        `Write every token with its value as the fallback, e.g. ${tokenExample}: some design systems define tokens only inside their components, and without the fallback they render nothing.`,
        `In {name}.test.${ext} import { render, screen } from "@testing-library/react", { describe, it, expect } from "vitest", and the component from "./{name}".`,
      ],
      importExample: `import { Button } from "${pkg}";`,
    };
  },

  shutdown: async () => {
    await closeProbeBrowser();
    await closeBrowser();
    return null;
  },
});
