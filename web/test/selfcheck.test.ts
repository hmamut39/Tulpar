// The self-check after a deploy, run here on a project this machine can build (Leptos): the reference passes, a
// hard-coded colour is caught, and one line is logged per project. In production it runs Compose and Vaadin.

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { cargoFound } from "../../adapters/leptos/src/sdk.ts";
import { crateSource } from "../../adapters/leptos/src/components.ts";
import { runSelfCheck, SELF_CHECKS, type SelfCheckCase } from "../src/selfcheck.ts";

const repo = resolve(import.meta.dirname, "../..");
const ready = cargoFound() && existsSync(join(repo, "examples/leptos-thaw/Cargo.lock")) && !!crateSource(join(repo, "examples/leptos-thaw"), "thaw");

const leptos: SelfCheckCase = {
  reference: "leptos",
  project: "leptos-thaw",
  entry: "order_card.rs",
  test: "order_card_test.rs",
  scale: { font: "Segoe UI", title: [20, 28], body: [14, 20], padding: 16, gap: 12, weights: [600, 400], colors: [[0.1412, 0.1412, 0.1412], [0.2588, 0.2588, 0.2588]] },
  colour: (f) => ({ ...f, "order_card.css": f["order_card.css"]!.replace("color: var(--colorNeutralForeground1, #242424);", "color: #242424;") }),
};

describe("self-check after a deploy", () => {
  it("has a reference on disk for every project it checks, and a colour defect that changes it", () => {
    for (const c of SELF_CHECKS) {
      expect(existsSync(join(repo, "cli/test/golden", c.reference, c.entry)), c.reference).toBe(true);
      const files = { [c.entry]: readFileSync(join(repo, "cli/test/golden", c.reference, c.entry), "utf8") };
      expect(c.colour(files)[c.entry], `${c.reference}: the colour defect changes nothing`).not.toBe(files[c.entry]);
    }
  });

  it.skipIf(!ready)("passes a reference, catches its hard-coded colour, and logs one line, with the queue to itself", { timeout: 600_000 }, async () => {
    const lines: string[] = [];
    let turns = 0;
    const results = await runSelfCheck({ repoRoot: repo, exclusive: async (fn) => (turns++, fn()), log: (l) => lines.push(l), cases: [leptos] });
    expect(results).toEqual([{ reference: "leptos", ok: true }]);
    expect(turns).toBe(1);
    const line = JSON.parse(lines[0]!);
    expect(line).toMatchObject({ event: "selfcheck", reference: "leptos", ok: true, colourCaught: true, failing: [] });
    expect(line.passed).toEqual(expect.arrayContaining(["build", "render", "colors", "layout", "text", "tests", "reusable", "accessible"]));
    expect(line.tokens.some((t: string) => /font-size|fontSize|lineHeight|spacing/i.test(t))).toBe(true);
  });
});
