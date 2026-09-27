// tulpar drift <projectDir> --from <version> --to <version>
//
// Replays two releases of the project's component package: each is fetched from npm,
// read by the project's own adapter, and the two readings are compared. Changes that
// touch confirmed mappings (explicit links) are findings, never silent re-matches.

import { execFileSync, execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import { compareIndexes, nodeOwners, type ComponentDef, type ComponentIndex, type DriftReport, type Library } from "@tulpar/core";
import { loadProject, withAdapter, type Project } from "./project.ts";

export async function drift(projectDir: string, fromVersion: string, toVersion: string, outDir: string): Promise<number> {
  const project = await loadProject(projectDir);
  const packages = (project.params.config.packages as string[] | undefined) ?? [];
  if (packages.length !== 1) {
    console.error(`drift replays one component package; ${project.config.adapter} config lists ${packages.length}.`);
    return 2;
  }
  const pkgName: string = JSON.parse(readFileSync(join(project.root, packages[0]!, "package.json"), "utf8")).name;

  const { before, after, links } = await withAdapter(project, async (host) => ({
    before: await host.call("index", withPackage(project, await releaseDir(project, pkgName, fromVersion))),
    after: await host.call("index", withPackage(project, await releaseDir(project, pkgName, toVersion))),
    links: host.manifest!.capabilities.links ? (await host.call("links", project.params)).links : [],
  }));

  // Confirmed mappings: explicit links, resolved to the Figma components they name.
  const libraryPath = join(outDir, "library.json");
  const confirmed = new Map<string, ComponentDef[]>();
  if (existsSync(libraryPath)) {
    const library: Library = JSON.parse(await readFile(libraryPath, "utf8"));
    const owners = nodeOwners(library);
    for (const l of links) {
      const def = owners.get(l.figma.nodeId);
      if (!def) continue;
      const list = confirmed.get(l.component) ?? [];
      if (!list.includes(def)) list.push(def);
      confirmed.set(l.component, list);
    }
  }

  const report = compareIndexes(before, after, { confirmed });
  const out = join(outDir, basename(project.root));
  await mkdir(out, { recursive: true });
  const file = join(out, `drift-${fromVersion}-to-${toVersion}.json`);
  await writeFile(file, JSON.stringify({ ...report, caveats: caveats(before, after, confirmed) }, null, 2));
  print(report, confirmed, before, after);
  console.log(`\nWritten to ${file}`);
  return report.bySeverity["breaks-mapping"] ? 1 : 0;
}

/** Fetch a release from npm once, unpacked inside the project so its own imports resolve. */
async function releaseDir(project: Project, pkg: string, version: string): Promise<string> {
  const base = join(project.root, ".tulpar", "releases", `${pkg.replace(/[@/]/g, "_")}@${version}`);
  const dir = join(base, "node_modules", ...pkg.split("/"));
  if (existsSync(join(dir, "package.json"))) return dir;
  if (!/^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/.test(pkg) || !/^[0-9A-Za-z.+-]+$/.test(version)) {
    throw new Error(`Refusing to fetch an unusual package spec: ${pkg}@${version}`);
  }
  await mkdir(base, { recursive: true });
  // One validated command string: npm is a script on Windows and needs a shell to run.
  const tgz = execSync(`npm pack ${pkg}@${version} --silent --pack-destination .`, { cwd: base, encoding: "utf8" }).trim().split("\n").at(-1)!;
  execFileSync("tar", ["-xzf", tgz], { cwd: base });
  // Copy rather than rename: Windows often locks freshly unpacked files for a moment.
  await cp(join(base, "package"), dir, { recursive: true });
  await rm(join(base, "package"), { recursive: true, force: true });
  await rm(join(base, tgz), { force: true });
  return dir;
}

function withPackage(project: Project, dir: string) {
  return { ...project.params, config: { ...project.params.config, packages: [relative(project.root, dir)] } };
}

function caveats(before: ComponentIndex, after: ComponentIndex, confirmed: Map<string, ComponentDef[]>): string[] {
  return [
    "Both releases are read with the project's current dependencies (e.g. its current lit or @types/react), not the ones each release was built against.",
    ...(confirmed.size ? [] : ["No confirmed mappings were available, so no finding is tied to a Figma component."]),
    ...before.gaps.map((g) => `${before.package?.version}: ${g}`),
    ...after.gaps.map((g) => `${after.package?.version}: ${g}`),
  ];
}

function print(r: DriftReport, confirmed: Map<string, ComponentDef[]>, before: ComponentIndex, after: ComponentIndex): void {
  const s = r.summary;
  console.log(`Drift ${r.from.package}@${r.from.version} → ${r.to.version}`);
  console.log(`  components: ${s.before} → ${s.after}; unchanged ${s.unchanged}, changed ${s.changed}, added ${s.added}, removed ${s.removed}, renamed ${s.renamed}`);
  console.log(`  confirmed mappings considered: ${confirmed.size} code components`);
  console.log(`  findings: ${r.bySeverity["breaks-mapping"]} break a mapping, ${r.bySeverity["affects-mapping"]} affect one, ${r.bySeverity.info} informational`);
  for (const f of r.findings.filter((f) => f.severity !== "info").slice(0, 40)) {
    const mark = f.severity === "breaks-mapping" ? "✗" : "!";
    console.log(`  ${mark} ${f.component}: ${f.detail}${f.figma ? `  [Figma: ${f.figma.join(", ")}]` : ""}${f.alignedFigmaProps ? `  ← ${f.alignedFigmaProps.join(", ")}` : ""}`);
  }
  const info = r.findings.filter((f) => f.severity === "info");
  const byKind = new Map<string, number>();
  for (const f of info) byKind.set(f.kind, (byKind.get(f.kind) ?? 0) + 1);
  if (info.length) console.log(`  informational (unmapped components): ${[...byKind].map(([k, n]) => `${k} ${n}`).join(", ")}`);
  for (const g of [...before.gaps, ...after.gaps].filter((g) => /not found|not read|no custom/i.test(g))) console.log(`  – ${g}`);
}
