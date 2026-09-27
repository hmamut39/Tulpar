import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const lib = createRequire(import.meta.url)("../lib.js");
const repo = resolve(import.meta.dirname, "../..");

describe("VS Code extension helpers", () => {
  it("finds the repository and its projects", () => {
    expect(lib.findRepo("", [repo])).toBe(repo);
    expect(lib.findRepo("", ["C:/nowhere"])).toBeUndefined();
    const ids = lib.findProjects(repo, []).map((p: { id: string }) => p.id);
    expect(ids).toEqual(expect.arrayContaining(["carbon", "carbon-react", "carbon-angular"]));
  });

  it("finds the project a file belongs to, and a test file next to it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tulpar-ext-"));
    await writeFile(join(dir, "tulpar.json"), '{"adapter":"react"}');
    await mkdir(join(dir, "src"));
    await writeFile(join(dir, "src", "Card.tsx"), "");
    await writeFile(join(dir, "src", "Card.test.tsx"), "");
    expect(lib.projectOf(join(dir, "src", "Card.tsx"))).toBe(dir);
    expect(lib.testFileFor(join(dir, "src", "Card.tsx"))).toBe(join(dir, "src", "Card.test.tsx"));
    expect(lib.collisions(join(dir, "src"), [{ path: "Card.tsx" }, { path: "Card.css" }])).toEqual([join(dir, "src", "Card.tsx")]);
  });

  it("builds CLI arguments and reads the --json result", () => {
    expect(lib.generateArgs({ repo: "/r", project: "/p", name: "Card", figmaUrl: "https://figma.com/x?node-id=1-2" }).slice(1)).toEqual(["generate", "/p", "--name", "Card", "--figma", "https://figma.com/x?node-id=1-2", "--json"]);
    expect(lib.parseResult('warning: something\n{"ok":true,"files":[]}\n')).toEqual({ ok: true, files: [] });
    expect(() => lib.parseResult("no json here")).toThrow("Tulpar printed no result.");
    expect(lib.isPascalCase("CheckoutCard")).toBe(true);
    expect(lib.isPascalCase("checkout-card")).toBe(false);
  });
});
