// SCSS and LESS style blocks are compiled before Svelte (and the checks) read them.

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { preprocessStyles } from "../src/compile.ts";
import { analyzeSvelte } from "../src/verify/analyze.ts";

describe("SCSS and LESS in a Svelte component", () => {
  it("compiles the style block to CSS and leaves plain blocks alone", () => {
    const scss = preprocessStyles(`<div class="a"></div>\n<style lang="scss">\n$gap: 8px;\n.a { .b { gap: $gap; } }\n</style>`, "/x/A.svelte");
    expect(scss).toContain("<style>");
    expect(scss).toContain(".a .b {\n  gap: 8px;\n}");
    const lessOut = preprocessStyles(`<style lang="less">\n@gap: 4px;\n.a { .b { gap: @gap; } }\n</style>`, "/x/A.svelte");
    expect(lessOut).toContain(".a .b {\n  gap: 4px;\n}");
    const plain = `<style>\n.a { gap: 0; }\n</style>`;
    expect(preprocessStyles(plain, "/x/A.svelte")).toBe(plain);
  });

  it("still sees a hard-coded value hidden in an SCSS variable", async () => {
    const root = mkdtempSync(join(tmpdir(), "tulpar-svelte-"));
    writeFileSync(join(root, "A.svelte"), `<div class="a"></div>\n<style lang="scss">\n$gap: 12px;\n.a { gap: $gap; }\n</style>\n`);
    const a = await analyzeSvelte(root, "A.svelte", "cds");
    expect(a.literals.map((l) => `${l.property} ${l.written}`)).toEqual(["gap 12px"]);
  });
});
