// tulpar verify <projectDir> <implementation> --frame <nodeId> [--theme white]

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import {
  FigmaClient,
  matchLibrary,
  nodeOwners,
  normalizeTree,
  verify,
  type Library,
  type VerifyReport,
} from "@tulpar/core";
import { loadProject, withAdapter } from "./project.ts";

export interface VerifyOptions {
  frame: string;
  theme?: string;
  out: string;
  cache: string;
  /** Print nothing; the caller reads the returned report. */
  quiet?: boolean;
}

export async function verifyCommand(projectDir: string, entry: string, options: VerifyOptions): Promise<{ code: number; report?: VerifyReport }> {
  const project = await loadProject(projectDir);
  const fileKey = project.config.figma?.fileKey;
  if (!fileKey) {
    console.error('tulpar.json has no "figma.fileKey".');
    return { code: 2 };
  }

  // The design: read from the local Figma cache only; verification never spends API budget.
  const client = new FigmaClient({ token: process.env.FIGMA_TOKEN ?? "", cacheDir: options.cache });
  client.offline = true;
  const found = await client.findCached(fileKey, options.frame);
  if (!found) {
    console.error(`Frame ${options.frame} is not in the local Figma cache. Fetch it first: tulpar model ${fileKey} ${options.frame}`);
    return { code: 2 };
  }
  const design = normalizeTree(found.entry.document, { fileKey, fileVersion: found.version, ...found.entry });

  const libraryPath = join(options.out, "library.json");
  const library: Library | undefined = existsSync(libraryPath) ? JSON.parse(await readFile(libraryPath, "utf8")) : undefined;

  const { report, png } = await withAdapter(project, async (host) => {
    const caps = host.manifest!.capabilities;
    const index = await host.call("index", project.params);
    const links = caps.links ? (await host.call("links", project.params)).links : [];

    // Which code component each Figma component stands for: explicit links, then confident matches.
    const mapping = new Map<string, string>();
    if (library) {
      const owners = nodeOwners(library);
      for (const l of links) {
        const def = owners.get(l.figma.nodeId);
        if (!def) continue;
        for (const id of [def.id, ...def.variants.map((v) => v.id)]) if (!mapping.has(id)) mapping.set(id, l.component);
      }
      for (const r of matchLibrary(library, index, { links })) {
        if ((r.tier === "verified" || r.tier === "likely") && r.best && !mapping.has(r.figma.id)) mapping.set(r.figma.id, r.best.component);
      }
    }

    const frame = { width: design.root.box!.width, height: design.root.box!.height };
    const build = caps.build ? await host.call("build", { ...project.params, entry, frame }) : undefined;
    const render =
      caps.render.supported && build?.ok && build.artifact
        ? await host.call("render", { ...project.params, artifact: build.artifact, entry, ...frame, scale: 1, ...(options.theme && { theme: options.theme }) })
        : undefined;
    const analysis = caps.staticProvenance ? await host.call("analyze", { ...project.params, entry }) : undefined;
    const report = verify({
      design,
      mapping,
      index,
      capabilities: caps,
      ...(build && { build }),
      ...(render && { render }),
      ...(analysis && { analysis }),
    });
    return { report, png: render?.status === "ok" ? render.png : undefined };
  });

  const out = join(options.out, basename(project.root), "verify", basename(entry).replace(/\.[^.]+$/, ""));
  await mkdir(out, { recursive: true });
  await writeFile(join(out, "report.json"), JSON.stringify(report, null, 2));
  if (png) await writeFile(join(out, "render.png"), Buffer.from(png, "base64"));
  if (!options.quiet) {
    printReport(report);
    console.log(`\nWritten to ${out}`);
  }
  return { code: report.verdict === "pass" ? 0 : 1, report };
}

export function printReport(r: VerifyReport): void {
  const mark = { pass: "✓", fail: "✗", "not-checked": "–" } as const;
  console.log(`${r.frame.name} (${r.frame.id}, ${r.frame.width}×${r.frame.height})`);
  for (const c of r.checks) {
    console.log(`  ${mark[c.status]} ${c.status === "not-checked" ? `${c.title}: not checked (${c.summary})` : c.summary}`);
    for (const d of c.details.filter((d) => !d.startsWith("✓"))) console.log(`      ${d}`);
  }
  for (const w of r.warnings) console.log(`  ! ${w}`);
  console.log(`Verdict: ${r.verdict.toUpperCase()}${r.verdict === "incomplete" ? " (no check failed, but not everything could be checked)" : ""}`);
  if (r.renderer) console.log(`Rendered with ${r.renderer.name} ${r.renderer.version} on ${r.renderer.os}`);
}
