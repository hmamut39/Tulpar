// Written when the image is built: what each framework's adapter says it can do (the languages and
// stylings it writes), so the server knows at once instead of starting every adapter on a cold start.
// Run: node deploy/manifests.ts  →  adapters/manifests.json
import { readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { AdapterManifest } from "@tulpar/core";
import { loadProject, withAdapter } from "../cli/src/project.ts";

const repo = resolve(import.meta.dirname, "..");
const manifests: Record<string, AdapterManifest> = {};
for (const dir of readdirSync(join(repo, "examples"))) {
  let project;
  try {
    project = await loadProject(join(repo, "examples", dir));
  } catch {
    continue; // not a project
  }
  if (manifests[project.config.adapter]) continue;
  const manifest = await withAdapter(project, async (host) => host.manifest);
  if (manifest) manifests[project.config.adapter] = manifest;
}
writeFileSync(join(repo, "adapters", "manifests.json"), JSON.stringify(manifests, null, 1));
console.log(`adapters/manifests.json: ${Object.keys(manifests).join(", ")}`);
