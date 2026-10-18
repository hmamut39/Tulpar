// How a page imports its sections, in each framework's own way.

import { describe, expect, it } from "vitest";
import type { Conventions } from "@tulpar/core";
import { importer } from "../src/page.ts";

const conv = (entry: string) => ({ entry }) as Conventions;

describe("importing a page's sections", () => {
  it("follows each framework's files", () => {
    expect(importer(conv("{name}.tsx"))!("SiteHeader")).toEqual({ name: "SiteHeader", importPath: "./SiteHeader" });
    expect(importer(conv("{name}.jsx"))!("Hero")).toEqual({ name: "Hero", importPath: "./Hero" });
    expect(importer(conv("{name}.vue"))!("Hero")).toEqual({ name: "Hero", importPath: "./Hero.vue" });
    expect(importer(conv("{name}.svelte"))!("Hero")).toEqual({ name: "Hero", importPath: "./Hero.svelte" });
    expect(importer(conv("{kebab}.component.ts"))!("SiteHeader")).toEqual({ name: "SiteHeaderComponent", importPath: "./site-header.component" });
    expect(importer(conv("{snake}.dart"))!("SiteHeader")).toEqual({ name: "SiteHeader", importPath: "site_header.dart" });
  });

  it("cannot compose Web Components' single HTML files", () => {
    expect(importer(conv("{name}.html"))).toBeUndefined();
  });
});
