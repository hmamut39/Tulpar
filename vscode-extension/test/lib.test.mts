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

describe("VS Code extension with tulparsi.com", () => {
  it("signs in through the site and accepts only the token that answers its own request", () => {
    const url = new URL(lib.connectUrl("https://tulparsi.com", "cursor", "Hmamut39.tulpar", "ab".repeat(16)));
    expect(url.pathname).toBe("/connect");
    expect(Object.fromEntries(url.searchParams)).toEqual({ scheme: "cursor", ext: "hmamut39.tulpar", state: "ab".repeat(16) });
    const token = `tlp_${"a".repeat(43)}`;
    expect(lib.tokenFromCallback(`token=${token}&state=${"ab".repeat(16)}`, "ab".repeat(16))).toBe(token);
    // Another window's sign-in, or none in progress, is refused; so is anything that is not a token.
    expect(lib.tokenFromCallback(`token=${token}&state=${"cd".repeat(16)}`, "ab".repeat(16))).toBeUndefined();
    expect(lib.tokenFromCallback(`token=${token}&state=`, undefined)).toBeUndefined();
    expect(lib.tokenFromCallback(`token=evil&state=${"ab".repeat(16)}`, "ab".repeat(16))).toBeUndefined();
  });

  it("sends the design, the language and styling, and reads the result like the CLI's", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tulpar-ext-"));
    await writeFile(join(dir, "s.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const body = lib.jobBody({ project: "element-plus", name: "Card", screenshot: join(dir, "s.png"), output: "javascript:scss" });
    expect(body).toEqual({ project: "element-plus", name: "Card", image: "data:image/png;base64,iVBORw==", language: "javascript", styling: "scss" });
    expect(() => lib.imageDataUrl(join(dir, "s.gif"))).toThrow(/PNG, JPEG or WebP/);
    expect(lib.fromJob({ state: "error", error: "Figma said no" })).toEqual({ ok: false, error: "Figma said no" });
    expect(lib.fromJob({ state: "done", result: { status: "verified", model: "m", attempts: [{}, {}], files: [{ path: "Card.vue", content: "" }], report: { verdict: "pass" } } })).toMatchObject({ ok: true, status: "verified", attempts: 2 });
    expect(lib.OUTPUTS.vue.map(([v]: [string]) => v)).toContain("typescript:less");
  });
});
