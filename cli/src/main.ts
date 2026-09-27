#!/usr/bin/env node
// tulpar CLI.
//
//   tulpar model <fileKey> <nodeId>...   Figma frames → design model JSON, with round-trip check
//   tulpar library <fileKey>             every component on every page → library JSON, with round-trip check
//
// Figma responses are cached in .cache/figma; outputs go to out/.

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import {
  FigmaClient,
  RateLimitError,
  extractLibrary,
  normalizeTree,
  roundTrip,
  type Figma,
  type Library,
  type RoundTripReport,
} from "@tulpar/core";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: "string", default: "out" },
    cache: { type: "string", default: ".cache/figma" },
    batch: { type: "string", default: "4" },
    offline: { type: "boolean", default: false },
  },
});

const [command, fileKey, ...rest] = positionals;
const client = FigmaClient.fromEnv(values.cache, (url) => console.error(`  GET ${url.slice(0, 120)}`));
client.offline = values.offline;

switch (command) {
  case "model":
    if (!fileKey || rest.length === 0) usage();
    process.exitCode = await model(fileKey, rest);
    break;
  case "library":
    if (!fileKey) usage();
    process.exitCode = await library(fileKey, Number(values.batch));
    break;
  default:
    usage();
}
console.error(`Figma requests sent: ${client.requestsSent} (the rest came from cache)`);

function usage(): never {
  console.error("usage: tulpar model <fileKey> <nodeId>...\n       tulpar library <fileKey> [--batch 4]");
  process.exit(2);
}

async function model(fileKey: string, nodeIds: string[]): Promise<number> {
  const res = await nodesOrCached(fileKey, nodeIds);
  const dir = join(values.out, "model");
  await mkdir(dir, { recursive: true });
  let failed = 0;
  for (const id of nodeIds) {
    const entry = res.nodes[id];
    if (!entry) {
      console.log(client.offline ? `– ${id}: not checked (not cached, and Figma was not called)` : `✗ ${id}: not found in file`);
      failed++;
      continue;
    }
    const tree = normalizeTree(entry.document, { fileKey, fileVersion: res.version, ...entry });
    await writeFile(join(dir, `${id.replace(/[:;]/g, "-")}.json`), JSON.stringify(tree, null, 2));
    const report = roundTrip(tree, entry.document);
    printReport(entry.document.name, report);
    if (report.mismatches.length) failed++;
  }
  return failed ? 1 : 0;
}

async function library(fileKey: string, batchSize: number): Promise<number> {
  const file = await client.file(fileKey, 1);
  const info = { fileKey, fileVersion: file.version, fileName: file.name };
  const pageIds = file.document.children!.map((p) => p.id);
  const components: Library["components"] = [];
  const styles = new Map<string, Library["styles"][number]>();
  const notChecked: string[] = [];
  const totals = { trees: 0, nodes: 0, boxes: 0, absent: 0, maxErr: 0, mismatches: [] as string[], unsupported: {} as Record<string, number> };

  // Pages are large (up to ~40 MB each), so each batch is processed and released before the next.
  for (let i = 0; i < pageIds.length; i += batchSize) {
    const res = await nodesOrCached(fileKey, pageIds.slice(i, i + batchSize));
    for (const [id, entry] of Object.entries(res.nodes)) {
      if (!entry) {
        notChecked.push(file.document.children!.find((p) => p.id === id)?.name.trim() ?? id);
        continue;
      }
      const partial = extractLibrary(info, [{ page: entry.document, ...entry }]);
      components.push(...partial.components);
      for (const s of partial.styles) styles.set(s.id, s);

      // Round-trip every component and component set on the page, each as its own tree.
      for (const root of definitionRoots(entry.document)) {
        const tree = normalizeTree(root, { fileKey, fileVersion: res.version, ...entry });
        const r = roundTrip(tree, root);
        totals.trees++;
        totals.nodes += r.nodes;
        totals.boxes += r.boxesChecked;
        totals.absent += r.boxesAbsent;
        totals.maxErr = Math.max(totals.maxErr, r.maxBoxError);
        totals.mismatches.push(...r.mismatches);
        for (const [k, n] of Object.entries(r.unsupported)) totals.unsupported[k] = (totals.unsupported[k] ?? 0) + n;
      }
    }
  }

  const lib: Library = { ...extractLibrary(info, []), components, styles: [...styles.values()].sort((a, b) => a.name.localeCompare(b.name)) };
  await mkdir(values.out, { recursive: true });
  await writeFile(join(values.out, "library.json"), JSON.stringify(lib, null, 2));

  const sets = lib.components.filter((c) => c.kind === "component-set");
  const singles = lib.components.filter((c) => c.kind === "component");
  console.log(`Library "${file.name}" (version ${file.version})`);
  console.log(`  pages read: ${pageIds.length - notChecked.length} of ${pageIds.length}`);
  if (notChecked.length) console.log(`  – not checked (${notChecked.length} pages, not cached): ${notChecked.join(", ")}`);
  console.log(`  component sets: ${sets.length} (${sets.filter((c) => !c.private).length} public), variants: ${sets.reduce((n, c) => n + c.variants.length, 0)}`);
  console.log(`  standalone components: ${singles.length} (${singles.filter((c) => !c.private).length} public)`);
  console.log(`  props: ${lib.components.reduce((n, c) => n + c.props.length, 0)}, styles: ${lib.styles.length}`);
  printReport(`all ${totals.trees} component trees`, {
    nodeId: "*",
    nodes: totals.nodes,
    boxesChecked: totals.boxes,
    boxesAbsent: totals.absent,
    maxBoxError: totals.maxErr,
    mismatches: totals.mismatches,
    unsupported: totals.unsupported,
  });
  // A partial library is never a success.
  return totals.mismatches.length || notChecked.length ? 1 : 0;
}

/** Fetch nodes; once Figma's long-window budget is spent, carry on from cache only. */
async function nodesOrCached(fileKey: string, ids: string[]): Promise<Figma.FileNodesResponse> {
  try {
    return await client.nodes(fileKey, ids);
  } catch (err) {
    if (!(err instanceof RateLimitError)) throw err;
    console.error(`  ${err.message}
  Continuing with cached data only.`);
    client.offline = true;
    return client.nodes(fileKey, ids);
  }
}

/** Top-level components and component sets on a page (not those nested inside other components). */
function definitionRoots(node: Figma.FigmaNode): Figma.FigmaNode[] {
  if (node.type === "COMPONENT_SET" || node.type === "COMPONENT") return [node];
  if (node.type === "INSTANCE") return [];
  return (node.children ?? []).flatMap(definitionRoots);
}

function printReport(label: string, r: RoundTripReport): void {
  const ok = r.mismatches.length === 0;
  console.log(`${ok ? "✓" : "✗"} ${label}`);
  console.log(`    nodes: ${r.nodes}, boxes checked: ${r.boxesChecked}, without bounds: ${r.boxesAbsent}, max box error: ${r.maxBoxError}`);
  for (const m of r.mismatches.slice(0, 10)) console.log(`    ${m}`);
  if (r.mismatches.length > 10) console.log(`    … ${r.mismatches.length - 10} more mismatches`);
  const unsupported = Object.entries(r.unsupported).sort((a, b) => b[1] - a[1]);
  if (unsupported.length) console.log(`    not expressed by the model: ${unsupported.map(([k, n]) => `${k} ×${n}`).join(", ")}`);
}
