// Component index for a Web Components package.
//
// Tier 0: the package's custom elements manifest. Carbon ships the older
//   web-component-analyzer (WCA) format; the standard Custom Elements Manifest
//   (CEM) is detected and reported as not read yet.
// Tier 1: the package's .d.ts files, through the TypeScript checker (declarations.ts).
// Heuristic: slot names scanned from the compiled templates (templates.ts).

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import type { CodeComponent, CodeEvent, CodeProp, CodeSlot, ComponentIndex, Provenance, TypeShape } from "@tulpar/core";
import { Declarations } from "./declarations.ts";
import { scanSlots } from "./templates.ts";

interface WcaTag {
  name: string;
  path: string;
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
  if (Array.isArray(manifest.modules)) {
    gaps.push(`${pkg.name}: standard Custom Elements Manifest (CEM) is not read yet; components not read.`);
    return { components: [], pkg };
  }
  if (!Array.isArray(manifest.tags)) {
    gaps.push(`${pkg.name}: unrecognised manifest format in ${relative(packageDir, manifestPath)}.`);
    return { components: [], pkg };
  }

  const tags = manifest.tags as WcaTag[];
  const decls = new Declarations(listFiles(join(packageDir, "es"), ".d.ts"));
  const counts = { noDts: 0, noClass: 0, propsUnresolved: 0 };
  const components = tags.map((tag) => component(tag, packageDir, pkg.name, decls, counts));

  if (counts.noDts) gaps.push(`${counts.noDts} elements have no .d.ts file; their prop types come from the manifest only.`);
  if (counts.noClass) gaps.push(`${counts.noClass} elements' classes were not found in their .d.ts file.`);
  if (counts.propsUnresolved) gaps.push(`${counts.propsUnresolved} props were not found on their class; types come from the manifest only.`);
  return { components, pkg };
}

function component(
  tag: WcaTag,
  packageDir: string,
  pkgName: string,
  decls: Declarations,
  counts: { noDts: number; noClass: number; propsUnresolved: number },
): CodeComponent {
  // "./src/components/button/button.ts" → "es/components/button/button"
  const stem = tag.path.replace(/^\.\/src\//, "es/").replace(/\.ts$/, "");
  const dts = join(packageDir, `${stem}.d.ts`);
  const js = join(packageDir, `${stem}.js`);

  const members = mergeMembers(tag);
  let cls: ReturnType<Declarations["findClass"]>;
  if (existsSync(dts)) {
    cls = decls.findClass(dts, members.map((m) => m.name));
    if (!cls) counts.noClass++;
  } else counts.noDts++;

  const props: CodeProp[] = [];
  for (const m of members) {
    const resolved = cls?.resolve(m.name);
    if (cls && !resolved) counts.propsUnresolved++;
    const provenance: Record<string, Provenance> = { name: WCA };
    let type: TypeShape | undefined = wcaType(m.type);
    if (type) provenance.type = { ...WCA, confidence: type.kind === "other" ? "low" : "medium" };
    if (resolved?.type) {
      type = resolved.type;
      provenance.type = DTS;
    }
    if (m.default !== undefined) provenance.default = WCA;
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

  const slots = mergeSlots(tag.slots ?? [], existsSync(js) ? scanSlots(readFileSync(js, "utf8")) : []);
  const events: CodeEvent[] = (tag.events ?? []).map((e) => ({ name: e.name, ...(e.description && { description: e.description }), provenance: WCA }));

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
    provenance: WCA,
  };
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

function mergeSlots(declared: { name: string; description?: string }[], scanned: string[]): CodeSlot[] {
  const slots = new Map<string, CodeSlot>();
  for (const s of declared) slots.set(s.name, { name: s.name, ...(s.description && { description: s.description }), provenance: WCA });
  for (const name of scanned) {
    const existing = slots.get(name);
    if (existing) existing.provenance = { source: "wca-manifest+template-scan", confidence: "high" };
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
