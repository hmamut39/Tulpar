// The harness page: the implementation, alone, at the Figma frame's exact size,
// with the project's global stylesheets and its own CSS marked as its own.

import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export interface RenderConfig {
  /** Stylesheets every page needs (theme, fonts), relative to the project root. */
  stylesheets?: string[];
  /** Font families the render must use, or it warns that text metrics are untrustworthy. */
  fonts?: string[];
  /** CSS class that applies a theme, per theme name, e.g. { "g10": "cds--g10" }. */
  themes?: Record<string, string>;
  /**
   * The page font an app using this design system sets on its body, e.g. "var(--sl-font-sans)".
   * Applied by the page, not the implementation, so it is never counted as the implementation's style.
   */
  baseFont?: string;
  /**
   * A project file that sets the app up the way the design system needs: for React, a component
   * that wraps the app (a theme provider); for Angular, a module exporting `providers`.
   */
  setup?: string;
  /** Class the library's root component puts on the app (e.g. "radix-themes" from Radix's <Theme>); always on the frame. */
  rootClass?: string;
}

/** Marks the implementation's own stylesheet, so the renderer can tell it from design-system CSS. */
export const IMPL_SOURCE_URL = "tulpar-implementation.css";
export const FRAME_ID = "tulpar-frame";

export interface HarnessInput {
  root: string;
  outDir: string;
  frame: { width: number; height: number };
  render: RenderConfig;
  /** The implementation's own CSS. */
  css: string;
  /** Markup placed inside the frame (may be empty when a script renders into it). */
  markup: string;
  /** Script file in outDir, loaded after the markup. */
  script: string;
  /** Design-system stylesheets the code imported, as absolute paths; loaded like `render.stylesheets`. */
  packageCss?: string[];
}

export async function writeHarness(h: HarnessInput): Promise<string> {
  const sheets = [...new Set([...(h.render.stylesheets ?? []).map((s) => resolve(h.root, s)), ...(h.packageCss ?? [])])];
  const links = sheets.map((s) => `<link rel="stylesheet" href="${pathToFileURL(s).href}">`).join("\n");
  const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
${links}
<style>html, body { margin: 0; padding: 0; } #${FRAME_ID} { position: relative;${h.render.baseFont && /^[\w\s"',()-]+$/.test(h.render.baseFont) ? ` font-family: ${h.render.baseFont};` : ""} overflow: hidden; width: ${h.frame.width}px; height: ${h.frame.height}px; }${h.render.setup ? ` #${FRAME_ID} > * { height: 100%; }` : ""}</style>
<style>${h.css}
/*# sourceURL=${IMPL_SOURCE_URL} */</style>
</head>
<body>
<div id="${FRAME_ID}">
${h.markup}
</div>
<script src="${h.script}"></script>
</body>
</html>
`;
  await mkdir(h.outDir, { recursive: true });
  const file = join(h.outDir, "index.html");
  await writeFile(file, page);
  return file;
}
