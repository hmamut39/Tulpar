// Component index for a Web Components package.
//
// Tier 0: the package's custom elements manifest: the older web-component-analyzer (WCA)
//   format (Carbon), or the standard Custom Elements Manifest (CEM, schema 1.x; Shoelace,
//   Lit-based libraries), converted to the same shape.
// Tier 1: the package's .d.ts files, through the TypeScript checker (declarations.ts).
// Heuristic: slot names scanned from the compiled templates (templates.ts).

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import type { CodeComponent, CodeEvent, CodeProp, CodeSlot, ComponentIndex, Provenance, TypeShape } from "@tulpar/core";
import { Declarations } from "./declarations.ts";
import { scanSlots } from "./templates.ts";

interface WcaTag {
  name: string;
  path: string;
  /** Module path without extension, relative to the package (CEM); WCA paths are mapped from src/ to es/. */
  stem?: string;
  description?: string;
  deprecated?: boolean;
  deprecatedMessage?: string;
  attributes?: WcaMember[];
  properties?: WcaMember[];
  events?: { name: string; description?: string }[];
  slots?: { name: string; description?: string }[];
  cssParts?: { name: string; description?: string }[];
}

interface WcaMember {
  name: string;
  attribute?: string;
  description?: string;
  type?: string;
  default?: string;
  deprecated?: boolean;
}

const WCA: Provenance = { source: "wca-manifest", confidence: "high" };
const CEM: Provenance = { source: "custom-elements-manifest", confidence: "high" };
const DTS: Provenance = { source: "ts-declarations", confidence: "high" };

export function indexPackage(packageDir: string, gaps: string[]): { components: CodeComponent[]; pkg: { name: string; version: string } } {
  const pkgJson = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
  const pkg = { name: pkgJson.name as string, version: pkgJson.version as string };
  const manifestPath = join(packageDir, pkgJson.customElements ?? "custom-elements.json");
  if (!existsSync(manifestPath)) {
    gaps.push(`${pkg.name}: no custom elements manifest; components not read.`);
    return { components: [], pkg };
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const isCem = Array.isArray(manifest.modules);
  if (!isCem && !Array.isArray(manifest.tags)) {
    gaps.push(`${pkg.name}: unrecognised manifest format in ${relative(packageDir, manifestPath)}.`);
    return { components: [], pkg };
  }

  const manifestDir = relative(packageDir, dirname(manifestPath)).split(sep).join("/");
  const tags = isCem ? cemTags(manifest, manifestDir) : (manifest.tags as WcaTag[]);
  const decls = new Declarations(listFiles(join(packageDir, isCem ? manifestDir : "es"), ".d.ts"));
  const counts = { noDts: 0, noClass: 0, propsUnresolved: 0 };
  const bases = new Map<string, string[]>();
  const components = tags.map((tag) => component(tag, packageDir, pkg.name, decls, counts, bases, isCem ? CEM : WCA));
  // A subclass of another indexed component is accepted wherever that component is expected.
  const byExport = new Map(components.filter((c) => c.exportName).map((c) => [c.exportName!, c.name]));
  for (const c of components) {
    const ext = (bases.get(c.name) ?? []).map((b) => byExport.get(b)).filter((n): n is string => !!n && n !== c.name);
    if (ext.length) c.extends = [...new Set(ext)];
  }

  if (counts.noDts) gaps.push(`${counts.noDts} elements have no .d.ts file; their prop types come from the manifest only.`);
  if (counts.noClass) gaps.push(`${counts.noClass} elements' classes were not found in their .d.ts file.`);
  if (counts.propsUnresolved) gaps.push(`${counts.propsUnresolved} props were not found on their class; types come from the manifest only.`);
  return { components, pkg };
}

/**
 * How code imports one element of this package, for the model's instructions: a real module
 * path from the manifest (a button if there is one).
 */
export function exampleImport(packageDir: string, pkgName: string): string {
  try {
    const pkgJson = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
    const manifestPath = join(packageDir, pkgJson.customElements ?? "custom-elements.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (Array.isArray(manifest.modules)) {
      const tags = cemTags(manifest, relative(packageDir, dirname(manifestPath)).split(sep).join("/"));
      const tag = tags.find((t) => /button/.test(t.name)) ?? tags[0];
      if (tag) return `${pkgName}/${tag.stem}.js`;
    }
  } catch {
    /* fall through to the conventional path */
  }
  return `${pkgName}/es/components/button/index.js`;
}

function component(
  tag: WcaTag,
  packageDir: string,
  pkgName: string,
  decls: Declarations,
  counts: { noDts: number; noClass: number; propsUnresolved: number },
  bases: Map<string, string[]>,
  source: Provenance,
): CodeComponent {
  // WCA: "./src/components/button/button.ts" → "es/components/button/button"
  const stem = tag.stem ?? tag.path.replace(/^\.\/src\//, "es/").replace(/\.ts$/, "");
  const dts = join(packageDir, `${stem}.d.ts`);
  const js = join(packageDir, `${stem}.js`);

  const members = mergeMembers(tag);
  let cls: ReturnType<Declarations["findClass"]>;
  if (existsSync(dts)) {
    cls = decls.findClass(dts, members.map((m) => m.name));
    if (!cls) counts.noClass++;
    else bases.set(tag.name, cls.bases);
  } else counts.noDts++;

  const props: CodeProp[] = [];
  for (const m of members) {
    const resolved = cls?.resolve(m.name);
    if (cls && !resolved) counts.propsUnresolved++;
    const provenance: Record<string, Provenance> = { name: source };
    let type: TypeShape | undefined = wcaType(m.type);
    if (type) provenance.type = { ...source, confidence: type.kind === "other" ? "low" : "medium" };
    if (resolved?.type) {
      type = resolved.type;
      provenance.type = DTS;
    }
    if (m.default !== undefined) provenance.default = source;
    provenance.required = { source: "platform", confidence: "medium", note: "custom elements cannot require an attribute or property" };

    const internal =
      resolved?.member === "static"
        ? "static class member, not an element prop"
        : resolved?.readonly && !m.attribute
          ? "read-only, no attribute"
          : undefined;

    props.push({
      name: m.name,
      aliases: m.attribute && m.attribute !== m.name ? [m.attribute] : [],
      ...(m.type !== undefined && { typeText: resolved?.typeText ?? m.type }),
      ...(type && { type }),
      ...(m.default !== undefined && m.default !== "undefined" && { defaultText: m.default }),
      required: false,
      ...(m.description && { description: m.description }),
      ...(m.deprecated && { deprecated: true }),
      ...(internal && { internal }),
      provenance,
    });
  }

  const slots = mergeSlots(tag.slots ?? [], existsSync(js) ? scanSlots(readFileSync(js, "utf8")) : [], source);
  const events: CodeEvent[] = (tag.events ?? []).map((e) => ({ name: e.name, ...(e.description && { description: e.description }), provenance: source }));

  return {
    id: `${pkgName}#${tag.name}`,
    name: tag.name,
    ...(cls && { exportName: cls.name }),
    module: `${pkgName}/${stem}.js`,
    sourcePath: tag.path,
    ...(tag.description && { description: tag.description }),
    ...(tag.deprecated && { deprecated: tag.deprecatedMessage ?? true }),
    props,
    slots,
    events,
    provenance: source,
  };
}

interface CemMember {
  kind?: string;
  name: string;
  type?: { text?: string };
  default?: string;
  description?: string;
  attribute?: string;
  fieldName?: string;
  privacy?: string;
  static?: boolean;
  deprecated?: boolean | string;
}

/**
 * Standard CEM → the WCA shape the rest of the indexer reads. Public fields become properties
 * (with their attribute); attributes without a field still set something. Private, protected
 * and static members, and methods, are not props.
 */
export function cemTags(manifest: { modules: { path: string; declarations?: Record<string, unknown>[] }[] }, manifestDir: string): WcaTag[] {
  const tags: WcaTag[] = [];
  for (const mod of manifest.modules) {
    for (const d of mod.declarations ?? []) {
      if (!d.customElement || typeof d.tagName !== "string") continue;
      const members = ((d.members as CemMember[] | undefined) ?? []).filter(
        (m) => m.kind === "field" && !m.static && (m.privacy ?? "public") === "public" && !m.name.startsWith("_") && !m.name.startsWith("#"),
      );
      const attributes = (d.attributes as CemMember[] | undefined) ?? [];
      const attrOf = new Map(attributes.filter((a) => a.fieldName).map((a) => [a.fieldName!, a.name]));
      const deprecated = d.deprecated as boolean | string | undefined;
      const description = (d.summary ?? d.description) as string | undefined;
      const path = `${manifestDir ? `${manifestDir}/` : ""}${mod.path.replace(/^\.\//, "")}`;
      tags.push({
        name: d.tagName,
        path,
        stem: path.replace(/\.(m?js|ts)$/, ""),
        ...(description && { description }),
        ...(deprecated && { deprecated: true, ...(typeof deprecated === "string" && { deprecatedMessage: deprecated }) }),
        properties: members.map((m) => {
          const attribute = m.attribute ?? attrOf.get(m.name);
          return {
            name: m.name,
            ...(attribute && { attribute }),
            ...(m.description && { description: m.description }),
            ...(m.type?.text && { type: m.type.text }),
            ...(m.default !== undefined && { default: m.default }),
            ...(m.deprecated && { deprecated: true }),
          };
        }),
        attributes: attributes.map((a) => ({ name: a.name, ...(a.description && { description: a.description }), ...(a.type?.text && { type: a.type.text }), ...(a.default !== undefined && { default: a.default }) })),
        events: ((d.events as { name?: string; description?: string }[] | undefined) ?? []).filter((e) => e.name).map((e) => ({ name: e.name!, ...(e.description && { description: e.description }) })),
        slots: ((d.slots as { name: string; description?: string }[] | undefined) ?? []).map((s) => ({ name: s.name, ...(s.description && { description: s.description }) })),
      });
    }
  }
  return tags;
}

/** WCA lists properties and attributes separately; an attribute without a property still sets something. */
function mergeMembers(tag: WcaTag): WcaMember[] {
  const members = [...(tag.properties ?? [])];
  const covered = new Set(members.map((m) => m.attribute).filter(Boolean));
  for (const a of tag.attributes ?? []) if (!covered.has(a.name)) members.push({ ...a, attribute: a.name });
  return members;
}

/** WCA type text, e.g. "boolean", "string | undefined", or an unresolved enum name like "BUTTON_KIND". */
function wcaType(text: string | undefined): TypeShape | undefined {
  if (!text) return undefined;
  const parts = text.split("|").map((s) => s.trim()).filter((s) => s !== "undefined" && s !== "null");
  if (parts.length === 1 && ["boolean", "string", "number"].includes(parts[0]!)) return { kind: parts[0] as "boolean" | "string" | "number" };
  const literals = parts.map((p) => /^(['"])(.*)\1$/.exec(p)?.[2]);
  if (parts.length && literals.every((l) => l !== undefined)) return { kind: "enum", values: literals as string[], open: false };
  return { kind: "other", text };
}

function mergeSlots(declared: { name: string; description?: string }[], scanned: string[], source: Provenance): CodeSlot[] {
  const slots = new Map<string, CodeSlot>();
  for (const s of declared) slots.set(s.name, { name: s.name, ...(s.description && { description: s.description }), provenance: source });
  for (const name of scanned) {
    const existing = slots.get(name);
    if (existing) existing.provenance = { source: `${source.source}+template-scan`, confidence: "high" };
    else slots.set(name, { name, provenance: { source: "template-scan", confidence: "medium", note: "found in the compiled template" } });
  }
  return [...slots.values()];
}

function listFiles(dir: string, suffix: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(suffix))
    .map((e) => join(e.parentPath, e.name));
}
