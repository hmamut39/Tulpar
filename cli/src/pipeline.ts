// The shared path from a project and a Figma frame to verified code:
// load the design from the local cache, work out the Figma → code mapping,
// and build + render + verify an implementation through the project's adapter.
// Used by `tulpar verify`, `tulpar generate` and the web app.

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  FigmaClient,
  flatten,
  maskBoxes,
  placeholderBoxes,
  createMatcher,
  matchLibrary,
  rerank,
  nodeOwners,
  normalizeTree,
  readScreenshot,
  verify,
  type Llm,
  type LlmImage,
  type AdapterHost,
  type ComponentIndex,
  type DesignTree,
  type ExplicitLink,
  type Library,
  type TokenSet,
  type RenderedElement,
  type VerifyReport,
  type Figma,
  type NormalizeContext,
} from "@tulpar/core";
import { designFontFaces } from "./fonts.ts";
import type { Project } from "./project.ts";

/** Which Figma frame to use, and how it may be fetched. */
export interface FrameInput {
  /** Node id, e.g. "3906:50588". */
  frame: string;
  /** The Figma file; defaults to the project's figma.fileKey. */
  fileKey?: string;
  /** A Figma token that may be used to fetch the frame when it isn't cached (e.g. the web user's own). */
  figmaToken?: string;
  /**
   * The frame as Figma's own REST JSON, sent by the Figma plugin (exportAsync JSON_REST_V1): its real
   * structure, no token or fetch needed. { document, components, componentSets, styles }.
   */
  node?: { document: unknown; components?: unknown; componentSets?: unknown; styles?: unknown };
}

/** The frame's design: from the local cache, or fetched once with the given token and cached. */
export async function loadDesign(project: Project, input: FrameInput, cacheDir: string): Promise<DesignTree> {
  if (input.node) {
    const n = input.node as { document: Figma.FigmaNode; components?: NormalizeContext["components"]; componentSets?: NormalizeContext["componentSets"]; styles?: NormalizeContext["styles"] };
    return normalizeTree(n.document, { fileKey: input.fileKey ?? "plugin", fileVersion: "plugin", components: n.components ?? {}, componentSets: n.componentSets ?? {}, styles: n.styles ?? {} });
  }
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
  // Without any explicit links (a design system with no Code Connect files for this framework),
  // the matcher's best proposals are the only mapping there is: used, and reported as unconfirmed.
  const accept = links.length ? ["verified", "likely"] : ["verified", "likely", "possible"];
  for (const r of matchLibrary(library, index, { links })) {
    if (accept.includes(r.tier) && r.best && !mapping.has(r.figma.id)) {
      mapping.set(r.figma.id, r.best.component);
      for (const v of library.components.find((d) => d.id === r.figma.id)?.variants ?? []) if (!mapping.has(v.id)) mapping.set(v.id, r.best.component);
    }
  }
  return mapping;
}

export interface Context {
  design: DesignTree;
  index: ComponentIndex;
  links: ExplicitLink[];
  mapping: Map<string, string>;
  library?: Library;
  tokens?: TokenSet;
  /** Where the design came from. A screenshot's boxes are estimates. */
  source: "figma" | "screenshot";
  /** An image of the design for the pixel comparison, PNG base64. */
  baseline?: { png: string; source: "screenshot" | "figma" };
  tolerance?: { box: number; text: number };
  /** Things the design reader was unsure of; shown as report warnings. */
  notes: string[];
}

/** Screenshot pixels per design point: 2 for a typical retina capture of a desktop UI. */
export function guessScale(width: number): number {
  return width > 1600 ? 2 : 1;
}

/** PNG size from its header, without decoding. */
export function pngSize(image: LlmImage): { width: number; height: number } | undefined {
  if (image.mime !== "image/png") return undefined;
  const b = Buffer.from(image.base64.slice(0, 64), "base64");
  return b.length >= 24 && b.toString("ascii", 12, 16) === "IHDR" ? { width: b.readUInt32BE(16), height: b.readUInt32BE(20) } : undefined;
}

/** A context whose design is read from a screenshot by the vision model. */
export async function loadScreenshotContext(host: AdapterHost, project: Project, input: { image: LlmImage; llm: Llm; scale?: number }, outDir: string): Promise<Context> {
  const library = await loadLibrary(outDir);
  const index = await host.call("index", project.params);
  const tokens = host.manifest!.capabilities.tokens ? await host.call("tokens", project.params) : undefined;
  const size = pngSize(input.image);
  const scale = input.scale ?? (size ? guessScale(size.width) : 1);
  const reading = await readScreenshot({ llm: input.llm, image: input.image, index, scale, ...(size && { size }) });
  return {
    design: reading.design,
    index,
    links: [],
    mapping: reading.mapping,
    ...(library && { library }),
    ...(tokens && { tokens }),
    source: "screenshot",
    ...(input.image.mime === "image/png" && { baseline: { png: flatten(input.image.base64), source: "screenshot" as const } }),
    tolerance: { box: 16, text: 16 },
    notes: [`The design was read from a screenshot at ${scale}× by a vision model: element boxes are estimates, so layout is checked within ±16 pt, and the pixel comparison is the stronger evidence.`, ...reading.notes],
  };
}

export async function loadContext(host: AdapterHost, project: Project, input: FrameInput, outDir: string, cacheDir: string): Promise<Context> {
  const design = await loadDesign(project, input, cacheDir);
  const library = await loadLibrary(outDir);
  const index = await host.call("index", project.params);
  const links = host.manifest!.capabilities.links ? (await host.call("links", project.params)).links : [];
  const mapping = buildMapping(library, index, links);
  mapByComponentKeys(mapping, library, design);
  const tokens = host.manifest!.capabilities.tokens ? await host.call("tokens", project.params) : undefined;
  const notes = links.length ? [] : ["This project has no explicit Figma ↔ code links (no Code Connect files): the Figma → component mapping comes from the matcher's uncalibrated proposals and is unconfirmed."];
  // Figma's own picture of the frame, for the pixel comparison: cached for good once fetched; fetched with
  // the user's token only when it isn't. A failure (rate limit, network) leaves the pixel check unchecked.
  const fileKey = input.fileKey ?? project.config.figma?.fileKey;
  const client = new FigmaClient({ token: input.figmaToken ?? "", cacheDir });
  client.offline = !input.figmaToken;
  const png = fileKey ? await client.frameImage(fileKey, input.frame).catch(() => undefined) : undefined;
  return { design, index, links, mapping, ...(library && { library }), ...(tokens && { tokens }), ...(png && { baseline: { png: maskBoxes(flatten(png), placeholderBoxes(design.root)), source: "figma" as const } }), source: "figma", notes };
}

/**
 * Asks the model to choose among the matcher's top candidates for each Figma component in the
 * frame that no explicit link covers. On Carbon its picks were right 65 of 67 times, and every
 * high-confidence pick was right (docs/04). Picks below medium confidence are not used.
 * Returns one note per decision, for the report; the mapping is updated in place.
 */
export async function rerankUnlinked(ctx: Context, llm: Llm, options: { max?: number } = {}): Promise<{ notes: string[]; usage: { inputTokens: number; outputTokens: number } }> {
  const usage = { inputTokens: 0, outputTokens: 0 };
  if (!ctx.library || ctx.source !== "figma") return { notes: [], usage };
  const owners = nodeOwners(ctx.library);
  const linked = new Set(ctx.links.map((l) => owners.get(l.figma.nodeId)?.id).filter(Boolean));
  const defs = new Map<string, NonNullable<ReturnType<typeof owners.get>>>();
  const visit = (n: DesignTree["root"]) => {
    if (n.kind === "instance") {
      const def = owners.get(n.component.id) ?? (n.component.set && owners.get(n.component.set.id));
      if (def && !linked.has(def.id)) defs.set(def.id, def);
    }
    if (n.kind !== "text") n.children.forEach(visit);
  };
  visit(ctx.design.root);
  const matcher = createMatcher(ctx.index);
  const todo = [...defs.values()].slice(0, options.max ?? 12);
  const notes: string[] = [];
  await Promise.all(Array.from({ length: 4 }, async () => {
    for (let def = todo.shift(); def; def = todo.shift()) {
      // A second opinion that fails is skipped, never a reason to stop the generation.
      const r = await rerank(def, matcher.rank(def), ctx.index, llm).catch(() => undefined);
      if (!r) continue;
      usage.inputTokens += r.usage.inputTokens;
      usage.outputTokens += r.usage.outputTokens;
      if (!r.choice || r.confidence === "low") continue;
      for (const id of [def.id, ...def.variants.map((v) => v.id)]) ctx.mapping.set(id, r.choice);
      notes.push(`"${def.name}" → ${r.choice}: the model's pick among the matcher's top 3 (${r.confidence} confidence), not confirmed by a link. ${r.reason}`);
    }
  }));
  return { notes: notes.sort(), usage };
}

/** Build, render and verify one implementation entry (relative to the project root). */
// The design's typefaces, fetched once per design (every attempt renders with them).
const FONT_FACES = new WeakMap<DesignTree, Promise<string>>();

export async function verifyEntry(host: AdapterHost, project: Project, ctx: Context, entry: string, theme?: string, testFile?: string): Promise<{ report: VerifyReport; png?: string; elements?: RenderedElement[] }> {
  const caps = host.manifest!.capabilities;
  const frame = { width: ctx.design.root.box!.width, height: ctx.design.root.box!.height };
  if (!FONT_FACES.has(ctx.design)) FONT_FACES.set(ctx.design, designFontFaces(ctx.design.root));
  const fontFaces = await FONT_FACES.get(ctx.design)!;
  const build = caps.build ? await host.call("build", { ...project.params, entry, frame }) : undefined;
  const render =
    caps.render.supported && build?.ok && build.artifact
      ? await host.call("render", { ...project.params, artifact: build.artifact, entry, ...frame, scale: 1, ...(theme && { theme }), ...(fontFaces && { fontFaces }) })
      : undefined;
  // The static scan needs no build, so it runs even when the build fails.
  const analysis = caps.staticProvenance ? await host.call("analyze", { ...project.params, entry }).catch(() => undefined) : undefined;
  // The implementation's own tests, in the adapter's sandbox; only when it built.
  const tests = caps.tests && testFile && build?.ok ? await host.call("test", { ...project.params, entry: testFile }) : undefined;
  const report = verify({
    design: ctx.design,
    ...(tests && { tests }),
    mapping: ctx.mapping,
    index: ctx.index,
    capabilities: caps,
    ...(ctx.tokens && { tokens: ctx.tokens }),
    ...(ctx.baseline && { baseline: ctx.baseline }),
    ...(ctx.tolerance && { tolerance: ctx.tolerance }),
    ...(build && { build }),
    // The render compared with the design's picture masked the same way: its placeholders and photos left out of both.
    ...(render && { render: ctx.baseline?.source === "figma" && render.status === "ok" && render.png ? { ...render, png: maskBoxes(render.png, placeholderBoxes(ctx.design.root)) } : render }),
    ...(analysis && { analysis }),
  });
  report.warnings.push(...ctx.notes);
  return { report, ...(render?.status === "ok" && { png: render.png, elements: render.elements }) };
}
