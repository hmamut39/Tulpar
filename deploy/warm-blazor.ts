// Run when the image is built: reads the Blazor example's components and theme once, so their caches
// (examples/blazor-mud/.tulpar) and the restored packages ship in the image. Fly restarts an idle
// machine, which would otherwise lose them and make the first Blazor run read them all again.
// Run: node deploy/warm-blazor.ts
import { join, resolve } from "node:path";
import { loadProject, withAdapter } from "../cli/src/project.ts";

const repo = resolve(import.meta.dirname, "..");
const project = await loadProject(join(repo, "examples", "blazor-mud"));
await withAdapter(project, async (host) => {
  if (!host.manifest?.capabilities.index) {
    console.log(".NET SDK not found: nothing to warm.");
    return;
  }
  const started = Date.now();
  const index = await host.call("index", project.params);
  const tokens = await host.call("tokens", project.params);
  console.log(`Blazor warmed in ${Math.round((Date.now() - started) / 1000)} s: ${index.components.length} components, ${tokens.tokens.length} tokens${tokens.gaps.length ? `; gaps: ${tokens.gaps.join("; ")}` : ""}`);
  if (!index.components.length || !tokens.tokens.length) process.exit(1);
});
