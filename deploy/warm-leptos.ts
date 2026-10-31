// Run when the image is built: compiles the Leptos example's dependencies once and reads its components and
// theme, so the compile output (examples/leptos-thaw/.tulpar/leptos/target) ships in the image and a run only
// compiles the generated component: seconds, not minutes.
// Run: node deploy/warm-leptos.ts
import { join, resolve } from "node:path";
import { loadProject, withAdapter } from "../cli/src/project.ts";

const repo = resolve(import.meta.dirname, "..");
const project = await loadProject(join(repo, "examples", "leptos-thaw"));
await withAdapter(project, async (host) => {
  if (!host.manifest?.capabilities.index) {
    console.log("Rust toolchain not found: nothing to warm.");
    return;
  }
  const started = Date.now();
  const index = await host.call("index", project.params);
  const tokens = await host.call("tokens", project.params);
  console.log(`Leptos warmed in ${Math.round((Date.now() - started) / 1000)} s: ${index.components.length} components, ${tokens.tokens.length} tokens${tokens.gaps.length ? `; gaps: ${tokens.gaps.join("; ")}` : ""}`);
  if (!index.components.length || !tokens.tokens.length) process.exit(1);
});
