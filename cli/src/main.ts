#!/usr/bin/env node
// tulpar CLI.
//
//   tulpar model <fileKey> <nodeId>...   Figma frames → design model JSON, with round-trip check
//   tulpar library <fileKey>             every component on every page → library JSON, with round-trip check
//   tulpar index <projectDir>            the project's adapter → component index + tokens, with coverage
//   tulpar match <projectDir>            Figma library ↔ code components; --evaluate scores against known links
//   tulpar verify <projectDir> <impl> --frame <nodeId>   build, render and check an implementation against a Figma frame
//   tulpar drift <projectDir> --from <v> --to <v>         what changed between two releases, and which mappings it touches
//
// Figma responses are cached in .cache/figma; outputs go to out/.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { loadDotEnv } from "./env.ts";
import { drift } from "./drift.ts";
import { generateCommand } from "./generate.ts";
import { match } from "./match.ts";
import { verifyCommand } from "./verify.ts";
import {
  AdapterHost,
  parseFigmaUrl,
  FigmaClient,
  RateLimitError,
  extractLibrary,
  indexCoverage,
  normalizeTree,
  roundTrip,
  tokenCoverage,
  type Figma,
  type Library,
  type RoundTripReport,
} from "@tulpar/core";

loadDotEnv();

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: "string", default: "out" },
    cache: { type: "string", default: ".cache/figma" },
    batch: { type: "string", default: "4" },
    offline: { type: "boolean", default: false },
    evaluate: { type: "boolean", default: false },
    frame: { type: "string" },
    theme: { type: "string" },
    from: { type: "string" },
    name: { type: "string" },
    figma: { type: "string" },
    image: { type: "string" },
    attempts: { type: "string" },
    to: { type: "string" },
  },
});

const [command, target, ...rest] = positionals;
let client: FigmaClient;

switch (command) {
  case "model":
    if (!target || rest.length === 0) usage();
    client = figmaClient();
    process.exitCode = await model(target, rest);
    break;
  case "library":
    if (!target) usage();
    client = figmaClient();
    process.exitCode = await library(target, Number(values.batch));
    break;
  case "index":
    if (!target) usage();
    process.exitCode = await index(target);
    break;
  case "match":
    if (!target) usage();
    process.exitCode = await match(target, values.out, values.evaluate);
    break;
  case "generate": {
    const ref = values.figma ? parseFigmaUrl(values.figma) : undefined;
    if (values.figma && !ref?.nodeId) {
      console.error("That Figma link has no frame in it: in Figma, right-click the frame → Copy link to selection.");
      process.exit(2);
    }
    const frame = ref?.nodeId ?? values.frame;
    if (!target || !frame || !values.name) usage();
    process.exitCode = (await generateCommand(target, { frame, ...(ref && { fileKey: ref.fileKey }), ...(process.env.FIGMA_TOKEN && { figmaToken: process.env.FIGMA_TOKEN }), name: values.name, out: values.out, cache: values.cache, ...(values.image && { image: values.image }), ...(values.attempts && { attempts: Number(values.attempts) }), ...(values.theme && { theme: values.theme }) })).code;
    break;
  }
  case "drift":
    if (!target || !values.from || !values.to) usage();
    process.exitCode = await drift(target, values.from, values.to, values.out);
    break;
  case "verify":
    if (!target || !rest[0] || !values.frame) usage();
    process.exitCode = (await verifyCommand(target, rest[0], { frame: values.frame, out: values.out, cache: values.cache, ...(values.theme && { theme: values.theme }) })).code;
    break;
  default:
    usage();
}

function figmaClient(): FigmaClient {
  const c = FigmaClient.fromEnv(values.cache, (url) => console.error(`  GET ${url.slice(0, 120)}`));
  c.offline = values.offline;
  process.on("exit", () => console.error(`Figma requests sent: ${c.requestsSent} (the rest came from cache)`));
  return c;
}

function usage(): never {
  console.error(
    [
      "usage: tulpar model <fileKey> <nodeId>... [--offline]",
      "       tulpar library <fileKey> [--batch 4] [--offline]",
      "       tulpar index <projectDir>",
      "       tulpar match <projectDir> [--evaluate]",
      "       tulpar verify <projectDir> <implementation> --frame <nodeId> [--theme <name>]",
      "       tulpar drift <projectDir> --from <version> --to <version>",
      "       tulpar generate <projectDir> (--figma <Figma frame link> | --frame <nodeId>) --name <ComponentName> [--image design.png] [--attempts 3]",
    ].join("\n"),
  );
  process.exit(2);
}

async function index(projectDir: string): Promise<number> {
  const root = resolve(projectDir);
  const config = JSON.parse(await readFile(join(root, "tulpar.json"), "utf8"));
  const adapterId: string = config.adapter;
  // Adapters are separate programs; the core only talks to them over stdio.
  const adapterMain = resolve(import.meta.dirname, "../../adapters", adapterId, "src/main.ts");
  const host = await AdapterHost.start(process.execPath, [adapterMain]);
  const params = { root, config: config[adapterId] ?? {} };
  const out = join(values.out, basename(root));
  await mkdir(out, { recursive: true });
  let failed = 0;
  try {
    const { id, protocolVersion, capabilities } = host.manifest!;
    console.log(`Adapter "${id}" (protocol ${protocolVersion})`);

    if (capabilities.index) {
      const idx = await host.call("index", params);
      await writeFile(join(out, "index.json"), JSON.stringify(idx, null, 2));
      const c = indexCoverage(idx);
      console.log(`\nComponent index${idx.package ? ` — ${idx.package.name}@${idx.package.version}` : ""}`);
      console.log(`  components: ${c.components} (${c.deprecatedComponents} deprecated, ${c.withDescription} described)`);
      console.log(`  props: ${c.props.total} (${c.props.designFacing} design-facing, ${c.props.internal} internal)`);
      console.log(`    by type: ${fmt(c.props.byType)}`);
      console.log(`    type read from: ${fmt(c.props.typeSource)}`);
      console.log(`    enums with values: ${c.props.enumsWithValues}; named types left unexpanded: ${c.props.unresolvedNamedTypes}`);
      console.log(`  slots: ${c.slots.total} (${fmt(c.slots.bySource)}); components without slots: ${c.slots.componentsWithout}`);
      console.log(`  events: ${c.events}`);
      if (Object.keys(c.lowConfidence).length) console.log(`  low-confidence fields: ${fmt(c.lowConfidence)}`);
      for (const g of c.gaps) console.log(`  – ${g}`);
      if (!c.components) failed++;
    } else console.log("– component index: not checked (the adapter does not support it)");

    if (capabilities.tokens) {
      const set = await host.call("tokens", params);
      await writeFile(join(out, "tokens.json"), JSON.stringify(set, null, 2));
      const t = tokenCoverage(set);
      console.log(`\nTokens`);
      console.log(`  tokens: ${t.tokens} (${fmt(t.byType)}); modes: ${t.modes.join(", ") || "none"}`);
      console.log(`  unresolved values: ${t.unresolvedValues}${t.unresolvedValues ? ` (${fmt(t.unresolvedReasons)})` : ""}`);
      console.log(`  code names not confirmed in code: ${t.unconfirmedCodeRefs} of ${t.tokens}`);
      for (const g of t.gaps) console.log(`  – ${g}`);
      if (!t.tokens) failed++;
    } else console.log("– tokens: not checked (the adapter does not support it)");

    console.log(`\nWritten to ${out}`);
  } finally {
    await host.stop();
  }
  return failed ? 1 : 0;
}

function fmt(counts: Record<string, number>): string {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k} ${n}`)
    .join(", ");
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
