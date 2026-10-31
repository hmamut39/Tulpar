// A Compose design system's components, read from its Kotlin source (the library's sources jar, unpacked by the
// project's tulparSources task). A public @Composable function with a capital name is a component: its parameters
// are props, @Composable lambdas slots, on… callbacks events, and a parameter without a default is required.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { CodeComponent, CodeProp, ComponentIndex, TypeShape } from "@tulpar/core";

export interface KotlinParam {
  name: string;
  type: string;
  required: boolean;
}

export interface KotlinComponent {
  name: string;
  params: KotlinParam[];
}

const provenance = { source: "kotlin-source", confidence: "high" as const };

/** The public, not deprecated, @Composable functions with a capital name in a Kotlin file. */
export function parseComponents(source: string): KotlinComponent[] {
  const out: KotlinComponent[] = [];
  const text = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const m of text.matchAll(/((?:@[\w.]+(?:\((?:[^()]|\([^()]*\))*\))?\s+)+)(public\s+)?fun\s+([A-Z]\w*)\s*\(/g)) {
    const annotations = m[1]!;
    if (!/@Composable\b/.test(annotations) || /@Deprecated\b/.test(annotations)) continue;
    const start = m.index + m[0].length;
    let depth = 1;
    let i = start;
    for (; i < text.length && depth > 0; i++) {
      if (text[i] === "(") depth++;
      else if (text[i] === ")") depth--;
    }
    out.push({ name: m[3]!, params: splitParams(text.slice(start, i - 1)).flatMap(parseParam) });
  }
  return out;
}

function splitParams(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
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

function parseParam(raw: string): KotlinParam[] {
  const m = /^\s*(?:@[\w.]+\s+)*(?:vararg\s+|noinline\s+|crossinline\s+)*(\w+)\s*:\s*([\s\S]+)$/.exec(raw);
  if (!m) return [];
  // The default starts at the first "=" at the top level, outside a type's own parentheses and "->".
  let depth = 0;
  let cut = -1;
  const rest = m[2]!;
  for (let i = 0; i < rest.length; i++) {
    const c = rest[i]!;
    if ("(<".includes(c)) depth++;
    else if (c === ")" || (c === ">" && rest[i - 1] !== "-")) depth--;
    else if (c === "=" && depth === 0) {
      cut = i;
      break;
    }
  }
  const type = (cut < 0 ? rest : rest.slice(0, cut)).replace(/\s+/g, " ").trim();
  return [{ name: m[1]!, type, required: cut < 0 }];
}

function shape(type: string): TypeShape {
  const inner = type.replace(/\?$/, "");
  if (inner === "Boolean") return { kind: "boolean" };
  if (inner === "String") return { kind: "string" };
  if (["Int", "Long", "Float", "Double", "Dp", "TextUnit"].includes(inner)) return { kind: "number" };
  return { kind: "other", text: type };
}

const isSlot = (p: KotlinParam) => p.type.includes("@Composable");
const isEvent = (p: KotlinParam) => !isSlot(p) && (/^on[A-Z]/.test(p.name) || p.type.includes("->"));

export function toComponent(c: KotlinComponent, module: string): CodeComponent {
  const prop = (p: KotlinParam): CodeProp => ({ name: p.name, aliases: [], typeText: p.type, type: shape(p.type), required: p.required, provenance: { name: provenance, type: provenance, required: provenance } });
  return {
    id: `${module}.${c.name}`,
    name: c.name,
    exportName: c.name,
    module,
    props: c.params.filter((p) => !isSlot(p) && !isEvent(p)).map(prop),
    slots: c.params.filter(isSlot).map((p) => ({ name: p.name === "content" ? "" : p.name, description: `${p.name}: ${p.type}${p.required ? " (required)" : ""}`, provenance })),
    events: c.params.filter(isEvent).map((p) => ({ name: p.name, description: `${p.type}${p.required ? " (required)" : ""}`, provenance })),
    provenance,
  };
}

function kotlinFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? kotlinFiles(join(dir, e.name)) : e.name.endsWith(".kt") ? [join(dir, e.name)] : []));
}

/** Of a name's overloads, the fullest: the one a design's props are most likely to fit. */
export function fullest(all: KotlinComponent[]): KotlinComponent[] {
  const best = new Map<string, KotlinComponent>();
  for (const c of all) if ((best.get(c.name)?.params.length ?? -1) < c.params.length) best.set(c.name, c);
  return [...best.values()];
}

export function indexComponents(root: string, library: { module: string; name: string; version: string }): ComponentIndex {
  const dir = join(root, ".tulpar", "compose", "sources", "commonMain", ...library.module.split("."));
  if (!existsSync(dir)) return { adapter: "compose", package: { name: library.name, version: library.version }, components: [], gaps: [`The source of ${library.name} was not found: run gradle tulparSources in the project.`] };
  const found = fullest(kotlinFiles(dir).flatMap((f) => parseComponents(readFileSync(f, "utf8"))));
  return { adapter: "compose", package: { name: library.name, version: library.version }, components: found.map((c) => toComponent(c, library.module)), gaps: found.length ? [] : [`No components found in ${library.name}.`] };
}
