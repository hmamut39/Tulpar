// A visitor's own Figma data is cached for their run only; the built-in kit's public file stays cached.

import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ScriptedLlm } from "@tulpar/core";
import { JobQueue } from "../src/jobs.ts";

describe("Figma data from a visitor's file", () => {
  it("is deleted when their run ends; the kit's shared cache is kept", async () => {
    const repo = mkdtempSync(join(tmpdir(), "tulpar-jobs-"));
    const project = join(repo, "examples", "kit");
    mkdirSync(project, { recursive: true });
    writeFileSync(join(project, "tulpar.json"), JSON.stringify({ adapter: "react", figma: { fileKey: "KITFILE" }, react: {} }));
    for (const key of ["KITFILE", "VISITORFILE"]) {
      mkdirSync(join(repo, ".cache/figma", key, "images"), { recursive: true });
      writeFileSync(join(repo, ".cache/figma", key, "images", "1-2@1x.png"), "x");
    }
    const queue = new JobQueue({ repoRoot: repo, llm: () => new ScriptedLlm([]) });
    queue.add({ projectDir: project, name: "Card", frame: "1:2", fileKey: "VISITORFILE" });
    queue.add({ projectDir: project, name: "Card", frame: "1:2", fileKey: "KITFILE" });
    await queue.idle();
    expect(existsSync(join(repo, ".cache/figma", "VISITORFILE"))).toBe(false);
    expect(existsSync(join(repo, ".cache/figma", "KITFILE", "images", "1-2@1x.png"))).toBe(true);
  });
});
