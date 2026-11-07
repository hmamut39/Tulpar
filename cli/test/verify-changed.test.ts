// Which listed components a pull request touches, and the Figma frame each one implements.
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { frameOf, touched, type VerifyTarget } from "../src/verify-changed.ts";

const project = resolve("/repo/app");
const targets: VerifyTarget[] = [
  { entry: "src/SignInCard.tsx", figma: "https://www.figma.com/design/abc/File?node-id=12-34", test: "test/SignInCard.test.tsx" },
  { entry: "src/Header.tsx", frame: "5:6" },
];

describe("verify-changed", () => {
  it("picks a component when its file, its test or a file beside it with its name changed", () => {
    expect(touched(targets, [join(project, "src/SignInCard.tsx")], project).map((t) => t.entry)).toEqual(["src/SignInCard.tsx"]);
    expect(touched(targets, [join(project, "test/SignInCard.test.tsx")], project).map((t) => t.entry)).toEqual(["src/SignInCard.tsx"]);
    expect(touched(targets, [join(project, "src/SignInCard.module.css")], project).map((t) => t.entry)).toEqual(["src/SignInCard.tsx"]);
    expect(touched(targets, [join(project, "src/SignInCardOld.tsx")], project)).toEqual([]);
    expect(touched(targets, [join(project, "src/Header.css")], project).map((t) => t.entry)).toEqual(["src/Header.tsx"]);
    expect(touched(targets, [join(project, "README.md")], project)).toEqual([]);
  });

  it("verifies every listed component when no changed files are given", () => {
    expect(touched(targets, [], project)).toHaveLength(2);
  });

  it("takes the frame from a Figma link or as given", () => {
    expect(frameOf(targets[0]!)).toBe("12:34");
    expect(frameOf(targets[1]!)).toBe("5:6");
    expect(frameOf({ entry: "x.tsx" })).toBeUndefined();
  });
});
