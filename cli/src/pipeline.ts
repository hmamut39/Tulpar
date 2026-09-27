// The shared path from a project and a Figma frame to verified code:
// load the design from the local cache, work out the Figma → code mapping,
// and build + render + verify an implementation through the project's adapter.
// Used by `tulpar verify`, `tulpar generate` and the web app.

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  FigmaClient,
  matchLibrary,
  nodeOwners,
  normalizeTree,
  verify,
  type AdapterHost,
  type ComponentIndex,
  type DesignTree,
  type ExplicitLink,
  type Library,
  type VerifyReport,
} from "@tulpar/core";
import type { Project } from "./project.ts";

/** The frame's design, from the local Figma cache only; never spends API budget. */
export async function loadDesign(project: Project, frame: string, cacheDir: string): Promise<DesignTree> {
  const fileKey = project.config.figma?.fileKey;
  if (!fileKey) throw new Error('tulpar.json has no "figma.fileKey".');
  const client = new FigmaClient({ token: process.env.FIGMA_TOKEN ?? "", cacheDir });
  client.offline = true;
  const found = await client.findCached(fileKey, frame);
  if (!found) throw new Error(`Frame ${frame} is not in the local Figma cache. Fetch it first: tulpar model ${fileKey} ${frame}`);
  return normalizeTree(found.entry.document, { fileKey, fileVersion: found.version, ...found.entry });
}

export async function loadLibrary(outDir: string): Promise<Library | undefined> {
  const path = join(outDir, "library.json");
  return existsSync(path) ? JSON.parse(await readFile(path, "utf8")) : undefined;
}

/** Which code component each Figma component stands for: explicit links first, then confident matches. */
export function buildMapping(library: Library | undefined, index: ComponentIndex, links: ExplicitLink[]): Map<string, string> {
  const mapping = new Map<string, string>();
  if (!library) return mapping;
  const owners = nodeOwners(library);
  for (const l of links) {
    const def = owners.get(l.figma.nodeId);
    if (!def) continue;
    for (const id of [def.id, ...def.variants.map((v) => v.id)]) if (!mapping.has(id)) mapping.set(id, l.component);
  }
  for (const r of matchLibrary(library, index, { links })) {
    if ((r.tier === "verified" || r.tier === "likely") && r.best && !mapping.has(r.figma.id)) mapping.set(r.figma.id, r.best.component);
  }
  return mapping;
}

export interface Context {
  design: DesignTree;
  index: ComponentIndex;
  links: ExplicitLink[];
  mapping: Map<string, string>;
  library?: Library;
}

export async function loadContext(host: AdapterHost, project: Project, frame: string, outDir: string, cacheDir: string): Promise<Context> {
  const design = await loadDesign(project, frame, cacheDir);
  const library = await loadLibrary(outDir);
  const index = await host.call("index", project.params);
  const links = host.manifest!.capabilities.links ? (await host.call("links", project.params)).links : [];
  return { design, index, links, mapping: buildMapping(library, index, links), ...(library && { library }) };
}

/** Build, render and verify one implementation entry (relative to the project root). */
export async function verifyEntry(host: AdapterHost, project: Project, ctx: Context, entry: string, theme?: string): Promise<{ report: VerifyReport; png?: string }> {
  const caps = host.manifest!.capabilities;
  const frame = { width: ctx.design.root.box!.width, height: ctx.design.root.box!.height };
  const build = caps.build ? await host.call("build", { ...project.params, entry, frame }) : undefined;
  const render =
    caps.render.supported && build?.ok && build.artifact
      ? await host.call("render", { ...project.params, artifact: build.artifact, entry, ...frame, scale: 1, ...(theme && { theme }) })
      : undefined;
  // The static scan needs no build, so it runs even when the build fails.
  const analysis = caps.staticProvenance ? await host.call("analyze", { ...project.params, entry }).catch(() => undefined) : undefined;
  const report = verify({
    design: ctx.design,
    mapping: ctx.mapping,
    index: ctx.index,
    capabilities: caps,
    ...(build && { build }),
    ...(render && { render }),
    ...(analysis && { analysis }),
  });
  return { report, ...(render?.status === "ok" && { png: render.png }) };
}
