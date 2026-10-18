// Run when the image is built: reads the Flutter example's widgets and theme once, so their caches
// (examples/flutter-material/.tulpar/cache) ship in the image. Fly restarts an idle machine, which
// would otherwise lose them and make every first Flutter run read Material's 483 widgets again.
// Run: node deploy/warm-flutter.ts
import { join, resolve } from "node:path";
import { loadProject, withAdapter } from "../cli/src/project.ts";

const repo = resolve(import.meta.dirname, "..");
const project = await loadProject(join(repo, "examples", "flutter-material"));
await withAdapter(project, async (host) => {
  if (!host.manifest?.capabilities.index) {
    console.log("Flutter SDK not found: nothing to warm.");
    return;
  }
  const started = Date.now();
  const index = await host.call("index", project.params);
  const tokens = await host.call("tokens", project.params);
  console.log(`Flutter warmed in ${Math.round((Date.now() - started) / 1000)} s: ${index.components.length} widgets, ${tokens.tokens.length} tokens${tokens.gaps.length ? `; gaps: ${tokens.gaps.join("; ")}` : ""}`);
  if (!index.components.length || !tokens.tokens.length) process.exit(1);
});
