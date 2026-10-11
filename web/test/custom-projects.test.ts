// Adding a design system from npm: what is accepted, and what the registry decides.

import { describe, expect, it } from "vitest";
import { projectId, resolvePackage } from "../src/custom-projects.ts";

const registry = (versions: Record<string, unknown>) =>
  (async (input: string | URL) => {
    const url = String(input);
    const hit = Object.entries(versions).find(([key]) => url.endsWith(key));
    return hit ? new Response(JSON.stringify(hit[1]), { status: 200 }) : new Response("{}", { status: 404 });
  }) as typeof fetch;

describe("adding a design system from npm", () => {
  it("refuses names and versions npm would refuse, before asking anyone", async () => {
    for (const bad of ["../etc/passwd", "UPPER/Case", "a b", "@scope/", "; rm -rf /", "x".repeat(215)]) {
      await expect(resolvePackage({ package: bad }, registry({}))).rejects.toThrow(/not an npm package name/);
    }
    await expect(resolvePackage({ package: "@acme/ui", version: "1.0 && curl" }, registry({}))).rejects.toThrow(/version is not valid/);
  });

  it("asks the registry for the exact version and works out the framework", async () => {
    const fetchImpl = registry({
      "/@acme%2Fui/latest": { version: "2.3.1", peerDependencies: { react: "^19" } },
      "/ng-kit/1.0.0": { version: "1.0.0", peerDependencies: { "@angular/core": "^22" } },
      "/wc-kit/latest": { version: "0.4.0", dependencies: { lit: "^3" } },
    });
    expect(await resolvePackage({ package: "@Acme/UI" }, fetchImpl)).toEqual({ name: "@acme/ui", version: "2.3.1", framework: "react" });
    expect(await resolvePackage({ package: "ng-kit", version: "1.0.0" }, fetchImpl)).toMatchObject({ framework: "angular" });
    expect(await resolvePackage({ package: "wc-kit" }, fetchImpl)).toMatchObject({ framework: "web-components" });
    expect(await resolvePackage({ package: "wc-kit", framework: "react" }, fetchImpl)).toMatchObject({ framework: "react" });
  });

  it("says plainly when a package does not exist or is too big", async () => {
    await expect(resolvePackage({ package: "nope-not-real" }, registry({}))).rejects.toThrow(/npm has no package nope-not-real/);
    await expect(resolvePackage({ package: "huge" }, registry({ "/huge/latest": { version: "1.0.0", dist: { unpackedSize: 500 * 1048576 } } }))).rejects.toThrow(/too large/);
  });

  it("names each package@version once, safely", () => {
    expect(projectId("@shoelace-style/shoelace", "2.20.1")).toBe("npm-shoelace-style-shoelace-2-20-1");
    expect(projectId("primeng", "22.1.2-rc.1")).toBe("npm-primeng-22-1-2-rc-1");
  });
});
