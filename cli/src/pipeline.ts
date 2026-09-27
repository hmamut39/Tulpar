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

/** Which Figma frame to use, and how it may be fetched. */
export interface FrameInput {
  /** Node id, e.g. "3906:50588". */
  frame: string;
  /** The Figma file; defaults to the project's figma.fileKey. */
  fileKey?: string;
  /** A Figma token that may be used to fetch the frame when it isn't cached (e.g. the web user's own). */
  figmaToken?: string;
}

/** The frame's design: from the local cache, or fetched once with the given token and cached. */
export async function loadDesign(project: Project, input: FrameInput, cacheDir: string): Promise<DesignTree> {
  const fileKey = input.fileKey ?? project.config.figma?.fileKey;
  if (!fileKey) throw new Error('No Figma file: pass a Figma link, or set "figma.fileKey" in tulpar.json.');
  const client = new FigmaClient({ token: input.figmaToken ?? "", cacheDir });
  client.offline = true;
  let found = await client.findCached(fileKey, input.frame);
  if (!found && input.figmaToken) {
    client.offline = false;
    const res = await client.nodes(fileKey, [input.frame]);
    const entry = res.nodes[input.frame];
    if (entry) found = { entry, version: res.version };
  }
  if (!found) {
    throw new Error(input.figmaToken ? `Figma has no node ${input.frame} in file ${fileKey}.` : `Frame ${input.frame} is not cached, and no Figma token was given to fetch it.`);
  }
  return normalizeTree(found.entry.document, { fileKey, fileVersion: found.version, ...found.entry });
}

/**
 * Frames from another Figma file (e.g. a team's feature file using the design-system library)
 * don't share node ids with the library file, but their instances carry the library
 * components' stable keys. Map those too.
 */
export function mapByComponentKeys(mapping: Map<string, string>, library: Library | undefined, design: DesignTree): void {
  if (!library) return;
  const byKey = new Map<string, string>();
  for (const def of library.components) {
    const component = mapping.get(def.id);
    if (!component) continue;
    if (def.key) byKey.set(def.key, component);
    for (const v of def.variants) if (v.key) byKey.set(v.key, component);
  }
  const visit = (n: DesignTree["root"]) => {
    if (n.kind === "instance" && !mapping.has(n.component.id)) {
      const component = (n.component.key && byKey.get(n.component.key)) ?? (n.component.set?.key && byKey.get(n.component.set.key));
      if (component) mapping.set(n.component.id, component);
    }
    if (n.kind !== "text") n.children.forEach(visit);
  };
  visit(design.root);
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

export async function loadContext(host: AdapterHost, project: Project, input: FrameInput, outDir: string, cacheDir: string): Promise<Context> {
  const design = await loadDesign(project, input, cacheDir);
  const library = await loadLibrary(outDir);
  const index = await host.call("index", project.params);
  const links = host.manifest!.capabilities.links ? (await host.call("links", project.params)).links : [];
  const mapping = buildMapping(library, index, links);
  mapByComponentKeys(mapping, library, design);
  return { design, index, links, mapping, ...(library && { library }) };
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
