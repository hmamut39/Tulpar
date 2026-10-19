// tulpar generate --page: a whole page as components. The frame is split into its sections; each is
// generated and verified on its own, then a page component places them (the model is told they exist
// and must not rebuild them), and the whole page is verified with them.

import { mkdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { NAME_PLACEHOLDERS, fillName, pageSections, type Conventions, type GeneratedFile } from "@tulpar/core";
import { generateCommand, type GenerateCommandOptions, type GenerateOutcome } from "./generate.ts";
import { loadDesign } from "./pipeline.ts";
import { loadProject, withAdapter } from "./project.ts";

export interface PageOutcome extends GenerateOutcome {
  sections: { name: string; figmaId: string; status: string }[];
}

export async function generatePageCommand(projectDir: string, options: GenerateCommandOptions): Promise<PageOutcome> {
  const log = options.quiet ? () => undefined : (s: string) => console.log(s);
  if (!options.frame) return { code: 2, error: "A page is read from a Figma frame: give a Figma link.", sections: [] };
  const project = await loadProject(projectDir);
  let design;
  try {
    design = await loadDesign(project, { frame: options.frame, ...(options.fileKey && { fileKey: options.fileKey }), ...(options.figmaToken && { figmaToken: options.figmaToken }) }, options.cache);
  } catch (err) {
    return { code: 2, error: (err as Error).message, sections: [] };
  }
  const sections = pageSections(design.root);
  if (sections.length < 2) {
    log("This frame is not a page of sections: generating it as one component.");
    return { ...(await generateCommand(projectDir, options)), sections: [] };
  }
  const output = options.output ?? (project.config.output as GenerateCommandOptions["output"]);
  const conventions: Conventions = await withAdapter(project, (host) => host.call("conventions", { ...project.params, ...(output && { output }) }));
  const importOf = importer(conventions);
  if (!importOf) return { code: 2, error: `${project.config.adapter} components cannot import one another, so a page cannot be composed from them.`, sections: [] };
  log(`A page of ${sections.length} sections: ${sections.map((s) => s.name).join(", ")}.`);

  // Each section, generated and verified on its own.
  const files: GeneratedFile[] = [];
  const done: PageOutcome["sections"] = [];
  const built: Record<string, { name: string; importPath: string }> = {};
  let failed = false;
  for (const [i, s] of sections.entries()) {
    log(`\n— Section ${s.name} (${s.node.id})`);
    options.onEvent?.({ type: "section", name: s.name, index: i + 1, total: sections.length });
    const outcome = await generateCommand(projectDir, { ...options, frame: s.node.id, name: s.name, resultsDir: join(tmpdir(), "tulpar-page", options.name, s.name) });
    if (!outcome.result) return { code: 2, error: `Section ${s.name}: ${outcome.error ?? "nothing generated"}`, sections: done };
    done.push({ name: s.name, figmaId: s.node.id, status: outcome.result.status });
    if (outcome.result.status === "failed") failed = true;
    files.push(...outcome.result.files);
    built[s.node.id] = importOf(s.name);
  }

  // The page: places the sections, verified as a whole with them.
  log(`\n— Page ${options.name}`);
  options.onEvent?.({ type: "section", name: options.name, index: sections.length + 1, total: sections.length, page: true });
  const page = await generateCommand(projectDir, { ...options, built, extraFiles: files, resultsDir: join(tmpdir(), "tulpar-page", options.name, "_page") });
  if (!page.result) return { code: 2, error: `The page: ${page.error ?? "nothing generated"}`, sections: done };

  // One folder: the sections' files, the page's, and a page report.
  const outDir = options.resultsDir ?? join(options.out, basename(project.root), "generated", options.name);
  await rm(outDir, { recursive: true, force: true });
  for (const f of [...files, ...page.result.files]) {
    await mkdir(dirname(join(outDir, f.path)), { recursive: true });
    await writeFile(join(outDir, f.path), f.content);
  }
  await writeFile(join(outDir, "tulpar-page.json"), JSON.stringify({ page: options.name, status: page.result.status, sections: done, report: page.result.report }, null, 2));
  if (page.png) await writeFile(join(outDir, "tulpar-render.png"), Buffer.from(page.png, "base64"));
  const status = failed || page.result.status === "failed" ? "failed" : page.result.status;
  log(`\nPage ${options.name}: ${status}. Sections: ${done.map((d) => `${d.name} ${d.status}`).join(", ")}.\nFiles: ${outDir}`);
  return { code: status === "failed" ? 1 : 0, result: { ...page.result, status, files: [...files, ...page.result.files] }, outDir, ...(page.png && { png: page.png }), sections: done };
}

/**
 * How the page imports a section, from the framework's file conventions: React and JavaScript files
 * without their extension, Vue and Svelte with it, Angular's component class from its .component file,
 * Dart by its file. Undefined when components cannot import one another (a Web Components HTML file).
 */
export function importer(c: Conventions): ((name: string) => { name: string; importPath: string }) | undefined {
  const entry = c.entry;
  if (/\.html$/.test(entry)) return undefined;
  return (name) => {
    const file = entry.replace(NAME_PLACEHOLDERS, (p) => fillName(p, name));
    if (/\.component\.ts$/.test(file)) return { name: `${name}Component`, importPath: `./${file.replace(/\.ts$/, "")}` };
    if (/\.(tsx?|jsx?)$/.test(file)) return { name, importPath: `./${file.replace(/\.(tsx?|jsx?)$/, "")}` };
    if (/\.(vue|svelte)$/.test(file)) return { name, importPath: `./${file}` };
    return { name, importPath: file };
  };
}
