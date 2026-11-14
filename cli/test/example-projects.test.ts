// The built-in example projects the site offers: every web one can run the tests a generation writes.
// Without Vitest's browser mode a project's tests are "not checked" on every run (chakra, mui and shoelace
// were, until 14 Nov 2026), and a different Playwright than the others' looks for a Chromium that isn't there.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..", "..", "examples");
const WEB = new Set(["react", "vue", "svelte", "angular", "web-components"]);
const web = readdirSync(root, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .flatMap((d) => {
    try {
      const config = JSON.parse(readFileSync(join(root, d.name, "tulpar.json"), "utf8"));
      if (!WEB.has(config.adapter)) return [];
      const pkg = JSON.parse(readFileSync(join(root, d.name, "package.json"), "utf8"));
      return [{ name: d.name, deps: { ...pkg.dependencies, ...pkg.devDependencies } as Record<string, string> }];
    } catch {
      return [];
    }
  });

describe("example projects", () => {
  it("finds the web examples", () => {
    expect(web.map((p) => p.name)).toEqual(expect.arrayContaining(["carbon", "carbon-react", "chakra", "mui", "shoelace", "radix"]));
  });

  it.each(web.map((p) => [p.name, p]))("%s has Vitest browser mode, so its generated tests run", (_, p) => {
    expect(p.deps.vitest, "vitest").toBeTruthy();
    expect(p.deps["@vitest/browser-playwright"], "@vitest/browser-playwright").toBeTruthy();
    expect(p.deps.playwright, "playwright").toBeTruthy();
  });

  it("all use one Playwright version (one Chromium in the image)", () => {
    const versions = new Set(web.map((p) => p.deps.playwright?.replace(/^[\^~]/, "")));
    expect([...versions]).toHaveLength(1);
  });
});
