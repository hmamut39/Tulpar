// A Leptos design system's components, read from the crate's source as cargo fetched it. A #[component]
// function's arguments are its props: Children are slots, callbacks events, and an argument that is
// not #[prop(optional)] or #[prop(default)] is required. Enums give the values a prop can take.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { CodeComponent, CodeProp, ComponentIndex, TypeShape } from "@tulpar/core";
import { registrySrc } from "./sdk.ts";

export interface RustArg {
  name: string;
  type: string;
  required: boolean;
  doc?: string;
}

export interface RustComponent {
  name: string;
  args: RustArg[];
}

const provenance = { source: "rust-source", confidence: "high" as const };

/** The #[component] functions in a Rust source file. */
export function parseComponents(source: string): RustComponent[] {
  const out: RustComponent[] = [];
  for (const m of source.matchAll(/#\[component\]\s*(?:#\[[^\]]*\]\s*)*pub\s+fn\s+([A-Z]\w*)\s*(<[^(]*>)?\s*\(/g)) {
    const start = m.index + m[0].length;
    let depth = 1;
    let i = start;
    for (; i < source.length && depth > 0; i++) {
      if (source[i] === "(") depth++;
      else if (source[i] === ")") depth--;
    }
    out.push({ name: m[1]!, args: splitArgs(source.slice(start, i - 1)).flatMap(parseArg) });
  }
  return out;
}

function splitArgs(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === "/" && text[i + 1] === "/") {
      const end = text.indexOf("\n", i);
      current += text.slice(i, end < 0 ? text.length : end);
      i = end < 0 ? text.length : end - 1;
      continue;
    }
    if ("([{<".includes(c)) depth++;
    else if (")]}".includes(c) || (c === ">" && text[i - 1] !== "-")) depth--;
    if (c === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else current += c;
  }
  if (current.trim()) parts.push(current);
  return parts;
}

function parseArg(raw: string): RustArg[] {
  const doc = [...raw.matchAll(/\/\/\/\s?([^\n]*)/g)].map((m) => m[1]!.trim()).join(" ");
  const attrs = [...raw.matchAll(/#\[prop\(([^\]]*)\)\]/g)].map((m) => m[1]!).join(",");
  const rest = raw.replace(/\/\/[^\n]*/g, "").replace(/#\[[^\]]*\]/g, "").trim();
  const m = /^(?:mut\s+)?(\w+)\s*:\s*([\s\S]+)$/.exec(rest);
  if (!m) return [];
  const type = m[2]!.replace(/\s+/g, " ").trim();
  return [{ name: m[1]!, type, required: !/\b(optional|optional_no_strip|default|strip_option)\b/.test(attrs) && !/^Option</.test(type), ...(doc && { doc }) }];
}

/** Every `pub enum` in a source file: its name and variants. */
export function parseEnums(source: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const m of source.matchAll(/pub\s+enum\s+(\w+)\s*\{([^}]*)\}/g)) {
    const variants = m[2]!.replace(/\/\/[^\n]*/g, "").replace(/#\[[^\]]*\]/g, "").split(",").map((v) => /^\s*([A-Z]\w*)\s*$/.exec(v)?.[1]).filter((v): v is string => !!v);
    if (variants.length) out.set(m[1]!, variants);
  }
  return out;
}

const SLOT = /^(Option<)?(Children|ChildrenFn|ChildrenFnMut|TypedChildren\b|ViewFn)/;
const EVENT = /^(Option<)?(BoxOneCallback|BoxCallback|ArcOneCallback|ArcCallback|Callback|impl Fn)/;

export function toComponent(c: RustComponent, crate: string, enums: Map<string, string[]>): CodeComponent {
  const isSlot = (a: RustArg) => a.name === "children" || SLOT.test(a.type);
  const isEvent = (a: RustArg) => /^on_/.test(a.name) || EVENT.test(a.type);
  return {
    id: `${crate}::${c.name}`,
    name: c.name,
    exportName: c.name,
    module: crate,
    props: c.args.filter((a) => !isSlot(a) && !isEvent(a)).map((a) => toProp(a, enums)),
    slots: c.args.filter(isSlot).map((a) => ({ name: a.name === "children" ? "" : a.name, description: `${a.name}: ${a.type}${a.required ? " (required)" : ""}`, provenance })),
    events: c.args.filter((a) => isEvent(a) && !isSlot(a)).map((a) => ({ name: a.name, description: a.type, provenance })),
    provenance,
  };
}

function toProp(a: RustArg, enums: Map<string, string[]>): CodeProp {
  return { name: a.name, aliases: [], typeText: a.type, type: shape(a.type, enums), required: a.required, ...(a.doc && { description: a.doc }), provenance: { name: provenance, type: provenance, required: provenance } };
}

function shape(type: string, enums: Map<string, string[]>): TypeShape {
  // Signal<ButtonAppearance>, MaybeProp<String>, Model<bool>, Option<…> wrap the value's own type.
  const inner = type.replace(/^(?:Option|MaybeProp|Signal|MaybeSignal|Model|RwSignal|OptionModel)<(.*)>$/, "$1").replace(/^(?:Option|MaybeProp|Signal|Model)<(.*)>$/, "$1");
  const values = enums.get(inner);
  if (values) return { kind: "enum", values: values.map((v) => `${inner}::${v}`), open: false };
  if (inner === "bool") return { kind: "boolean" };
  if (inner === "String" || inner === "&'static str") return { kind: "string" };
  if (/^[iuf](8|16|32|64|128|size)$/.test(inner)) return { kind: "number" };
  return { kind: "other", text: type };
}

function rustFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? rustFiles(join(dir, e.name)) : e.name.endsWith(".rs") ? [join(dir, e.name)] : []));
}

/** The version Cargo.lock pinned for a crate, and where cargo unpacked its source. */
export function crateSource(root: string, crate: string): { version: string; dir: string } | undefined {
  const lock = join(root, "Cargo.lock");
  const src = registrySrc();
  if (!existsSync(lock) || !src || !existsSync(src)) return undefined;
  const version = new RegExp(`name = "${crate}"\\s+version = "([^"]+)"`).exec(readFileSync(lock, "utf8"))?.[1];
  if (!version) return undefined;
  for (const registry of readdirSync(src)) {
    const dir = join(src, registry, `${crate}-${version}`, "src");
    if (existsSync(dir)) return { version, dir };
  }
  return undefined;
}

export function indexComponents(root: string, crates: string[]): ComponentIndex {
  const gaps: string[] = [];
  const components: CodeComponent[] = [];
  let pkg: { name: string; version: string } | undefined;
  for (const crate of crates) {
    const found = crateSource(root, crate);
    if (!found) {
      gaps.push(`The source of ${crate} was not found: run cargo fetch in the project.`);
      continue;
    }
    pkg ??= { name: crate, version: found.version };
    const sources = rustFiles(found.dir).map((f) => readFileSync(f, "utf8"));
    const enums = new Map(sources.flatMap((s) => [...parseEnums(s)]));
    for (const s of sources) for (const c of parseComponents(s)) components.push(toComponent(c, crate, enums));
  }
  if (!components.length) gaps.push(`No components found in ${crates.join(", ")}.`);
  return { adapter: "leptos", ...(pkg && { package: pkg }), components, gaps };
}
