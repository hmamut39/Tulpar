// tulpar init: finding a team's own design system in a project it has never seen.

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { baseFontToken, detect } from "../src/init.ts";

function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "tulpar-init-"));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

const props = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `  --${prefix}-color-${i}: #${String(i).padStart(6, "0")};`).join("\n");

describe("tulpar init", () => {
  const root = project({
    "package.json": JSON.stringify({ dependencies: { react: "19", "@acme/ui": "1", lodash: "4", "left-pad": "1" } }),
    "node_modules/react/package.json": JSON.stringify({ name: "react" }),
    "node_modules/lodash/package.json": JSON.stringify({ name: "lodash" }),
    "node_modules/left-pad/package.json": JSON.stringify({ name: "left-pad", description: "pads strings" }),
    "node_modules/@acme/ui/package.json": JSON.stringify({ name: "@acme/ui", keywords: ["design-system", "react"], peerDependencies: { react: "*" } }),
    "node_modules/@acme/ui/dist/index.d.ts": "export declare function Button(): null;",
    "node_modules/@acme/ui/dist/styles.css": ".acme-button { color: red; }",
    "node_modules/@acme/tokens/package.json": JSON.stringify({ name: "@acme/tokens" }),
    "node_modules/@acme/tokens/css/theme.css": `:root, .acme-theme-light {\n${props("acme", 30)}\n}\n.acme-theme-dark {\n${props("acme", 30)}\n}`,
    "node_modules/@acme/tokens/cdn/theme.css": `:root {\n${props("acme", 30)}\n}`,
    "src/button.figma.tsx": "figma.connect(Button, 'https://figma.com/design/K?node-id=1-2', {})",
  });
  const found = detect(root, { figma: "https://www.figma.com/design/AbC123/Kit?node-id=1-2" });
  const section = found.config.react as Record<string, any>;

  it("finds the framework and the design-system package, and says why", () => {
    expect(found.adapter).toBe("react");
    expect(section.packages).toEqual(["node_modules/@acme/ui"]);
    expect(found.why.join("\n")).toMatch(/design system: @acme\/ui \(.*framework peer dependency/);
    expect(found.config.figma).toEqual({ fileKey: "AbC123" });
  });

  it("finds tokens in a sibling package, once per file, with the prefix and themes, light first", () => {
    expect(section.tokens.css).toEqual({
      files: ["node_modules/@acme/tokens/css/theme.css"],
      prefix: "acme",
      modes: { light: ".acme-theme-light", dark: ".acme-theme-dark" },
    });
    expect(section.render.themes).toEqual({ light: "acme-theme-light", dark: "acme-theme-dark" });
    expect(section.render.stylesheets).toEqual(["node_modules/@acme/tokens/css/theme.css", "node_modules/@acme/ui/dist/styles.css"]);
  });

  it("finds the page font token, preferring a base or body font over sans", () => {
    expect(baseFontToken(["--sl-font-mono", "--sl-font-sans", "--sl-font-serif"], "sl")).toBe("--sl-font-sans");
    expect(baseFontToken(["--acme-font-family-sans", "--acme-font-family-base"], "acme")).toBe("--acme-font-family-base");
    expect(baseFontToken(["--acme-color-1"], "acme")).toBeUndefined();
  });

  it("finds the project's own Code Connect files", () => {
    expect(section.codeConnect).toEqual(["src"]);
  });

  it("asks for the package when nothing looks like a design system", () => {
    const bare = project({ "package.json": JSON.stringify({ dependencies: { react: "19", "left-pad": "1" } }), "node_modules/left-pad/package.json": JSON.stringify({ name: "left-pad" }) });
    expect(() => detect(bare)).toThrow(/tulpar init --package/);
  });
});
