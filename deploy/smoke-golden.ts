// Image smoke test, the golden gate for the languages CI's own runners do not have (Blazor's .NET, Leptos's Rust):
// in the image, as the server's user, each reference order card (cli/test/golden) must pass every check that runs,
// and the same card with one hard-coded colour must fail the colour check. No model is called.
// Run: node deploy/smoke-golden.ts
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { orderCard, type Scale } from "../cli/src/order-card.ts";
import { loadContext, verifyEntry } from "../cli/src/pipeline.ts";
import { loadProject, withAdapter } from "../cli/src/project.ts";
import type { VerifyReport } from "@tulpar/core";

const repo = resolve(import.meta.dirname, "..");
const cases: { reference: string; project: string; entry: string; style: string; test?: string; scale: Scale }[] = [
  { reference: "blazor", project: "examples/blazor-mud", entry: "OrderCard.razor", style: "OrderCard.razor.css", scale: { font: "Roboto", title: [20, 32], body: [14, 20], padding: 16, gap: 8, weights: [500, 400], colors: [[0.2588, 0.2588, 0.2588], [0.2588, 0.2588, 0.2588]] } },
  { reference: "leptos", project: "examples/leptos-thaw", entry: "order_card.rs", style: "order_card.css", test: "order_card_test.rs", scale: { font: "Segoe UI", title: [20, 28], body: [14, 20], padding: 16, gap: 12, weights: [600, 400], colors: [[0.1412, 0.1412, 0.1412], [0.2588, 0.2588, 0.2588]] } },
];

async function verifyFiles(c: (typeof cases)[number], name: string, files: Record<string, string>): Promise<VerifyReport> {
  const root = join(repo, c.project);
  const dir = join(root, ".tulpar", "golden", name);
  mkdirSync(dir, { recursive: true });
  for (const [f, content] of Object.entries(files)) writeFileSync(join(dir, f), content);
  const rel = (f: string) => `.tulpar/golden/${name}/${f}`;
  const project = await loadProject(root);
  try {
    return await withAdapter(project, async (host) => {
      const ctx = await loadContext(host, project, { frame: "900:1", node: orderCard(c.scale) }, join(repo, "out"), join(repo, ".cache/figma"));
      return (await verifyEntry(host, project, ctx, rel(c.entry), undefined, c.test ? rel(c.test) : undefined)).report;
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

let failed = 0;
for (const c of cases) {
  const golden = join(repo, "cli", "test", "golden", c.reference);
  const files = Object.fromEntries(readdirSync(golden).map((f) => [f, readFileSync(join(golden, f), "utf8")]));
  const started = Date.now();
  const reference = await verifyFiles(c, "reference", files);
  const failing = reference.checks.filter((x) => x.status === "fail");
  const ran = reference.checks.filter((x) => x.status === "pass").map((x) => x.id);
  const missing = ["build", "render", "colors", "layout", "text", "safety", "reusable"].filter((id) => !ran.includes(id as never));
  const colour = await verifyFiles(c, "colour", { ...files, [c.style]: files[c.style]!.replace(/(\n\s*color: )var\(--[\w-]+, (#[0-9a-f]{6})\)/, "$1$2") });
  const caught = colour.checks.find((x) => x.id === "colors")?.status === "fail";
  const ok = !failing.length && !missing.length && caught;
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${c.reference}: ${failing.length ? `reference fails ${failing.map((x) => `${x.id} (${x.summary})`).join(", ")}; ` : ""}${missing.length ? `did not pass ${missing.join(", ")}; ` : ""}${caught ? "hard-coded colour caught" : "hard-coded colour NOT caught"} · ${Math.round((Date.now() - started) / 1000)}s`);
}
process.exit(failed ? 1 : 0);
