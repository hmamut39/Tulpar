// A project's own rules reach the model, whichever adapter it uses, and once.
import { describe, expect, it } from "vitest";
import type { Conventions } from "@tulpar/core";
import { withProjectRules, type Project } from "../src/project.ts";

const project = (rules?: unknown): Project => ({ root: "/p", config: { adapter: "react" }, params: { root: "/p", config: rules === undefined ? {} : { rules } } });
const conventions = (rules: string[]): Conventions => ({ language: "TypeScript", framework: "React", files: [], entry: "{name}.tsx", rules, importExample: "" });

describe("a project's own rules", () => {
  it("join the adapter's rules", () => {
    expect(withProjectRules(project(["20px is xl"]), conventions(["Default-export the component."])).rules).toEqual(["Default-export the component.", "20px is xl"]);
  });

  it("are not repeated when the adapter already passes them on", () => {
    expect(withProjectRules(project(["Use MudStack."]), conventions(["Use Typo.", "Use MudStack."])).rules).toEqual(["Use Typo.", "Use MudStack."]);
  });

  it("are ignored when they are not a list of words", () => {
    expect(withProjectRules(project("nope"), conventions(["a"])).rules).toEqual(["a"]);
    expect(withProjectRules(project([1, "ok"]), conventions(["a"])).rules).toEqual(["a", "ok"]);
  });
});
