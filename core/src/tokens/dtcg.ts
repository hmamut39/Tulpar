// Reader for W3C Design Tokens (DTCG) documents.
// Format: https://www.designtokens.org/tr/2025.10/format/
//
// Beyond the spec, it tolerates two things real systems do:
// - per-mode values kept in an extension instead of $value (named by `modesExtension`);
// - tokens that also contain child tokens (the spec forbids it; Carbon does it).
// Each departure from the spec is reported in `gaps`, never silently accepted.

import type { Color } from "../model.ts";
import type { DesignToken, Provenance, TokenValue } from "../code-model.ts";

export interface DtcgDocument {
  /** A label for provenance, e.g. "@carbon/themes/src/dtcg/themes.json". */
  label: string;
  json: Record<string, unknown>;
  /** Only resolve aliases against this document; don't return its tokens (e.g. a colour palette). */
  referenceOnly?: boolean;
}

export interface DtcgOptions {
  /** `$extensions` key holding `{ mode: value }`, e.g. "carbon.themes". */
  modesExtension?: string;
  /** The modes that exist. Values under any other key are skipped and reported. Default: every key found. */
  modes?: string[];
  /** Flat token name from its path. Default: segments joined with "-", without repeating a group name the segment already starts with. */
  name?: (path: string[]) => string;
  /** Resolve a dimension the spec reader cannot, e.g. a bare number with a system-specific unit. */
  dimension?: (raw: unknown, token: RawToken) => TokenValue | undefined;
  /** How code refers to a token, e.g. name => `var(--cds-${name})`. */
  codeRef?: (name: string) => string;
  /** Root font size used to turn rem into points. Default 16. */
  remBase?: number;
}

export interface RawToken {
  path: string[];
  type?: string;
  node: Record<string, unknown>;
  doc: DtcgDocument;
}

export interface DtcgResult {
  modes: string[];
  tokens: DesignToken[];
  gaps: string[];
}

const DEFAULT_MODE = "default";

export function readDtcg(docs: DtcgDocument[], options: DtcgOptions = {}): DtcgResult {
  const gaps = new Set<string>();
  const byPath = new Map<string, RawToken>();
  for (const doc of docs) collect(doc.json, [], undefined, doc, byPath, gaps, options);

  const modes = new Set<string>();
  const tokens: DesignToken[] = [];
  for (const raw of byPath.values()) {
    if (raw.doc.referenceOnly) continue;
    const values: Record<string, TokenValue> = {};
    const perMode = modeValues(raw, options);
    for (const [mode, value] of Object.entries(perMode)) {
      if (options.modes && mode !== DEFAULT_MODE && !options.modes.includes(mode)) {
        gaps.add(`${raw.doc.label}: "${raw.path.join(".")}" has a value for "${mode}", which is not a configured mode; ignored.`);
        continue;
      }
      if (mode !== DEFAULT_MODE) modes.add(mode);
      values[mode] = resolve(value, raw, mode, byPath, options, new Set());
    }
    const name = (options.name ?? flatName)(raw.path);
    const description = raw.node.$description;
    const provenance: Provenance = { source: "dtcg", confidence: "high", note: raw.doc.label };
    if (Object.values(values).some((v) => v.kind === "unresolved")) provenance.confidence = "medium";
    tokens.push({
      name,
      path: raw.path,
      type: raw.type ?? "unknown",
      ...(typeof description === "string" && { description }),
      values,
      ...(options.codeRef && { codeRef: options.codeRef(name) }),
      ...(raw.node.$deprecated !== undefined && raw.node.$deprecated !== false && { deprecated: true }),
      provenance,
    });
  }
  return { modes: [...modes], tokens, gaps: [...gaps] };
}

/** ["border","subtle","02"] → "border-subtle-02"; ["spacing","spacing-01"] → "spacing-01". */
export function flatName(path: string[]): string {
  return path.reduce((acc, seg) => (acc && !seg.startsWith(`${acc}-`) ? `${acc}-${seg}` : seg), "");
}

function isToken(node: Record<string, unknown>, options: DtcgOptions): boolean {
  if ("$value" in node) return true;
  const ext = node.$extensions as Record<string, unknown> | undefined;
  return !!options.modesExtension && !!ext && options.modesExtension in ext;
}

function collect(
  node: Record<string, unknown>,
  path: string[],
  inheritedType: string | undefined,
  doc: DtcgDocument,
  out: Map<string, RawToken>,
  gaps: Set<string>,
  options: DtcgOptions,
): void {
  const type = typeof node.$type === "string" ? node.$type : inheritedType;
  const token = path.length > 0 && isToken(node, options);
  if (token) out.set(path.join("."), { path, type, node, doc });
  else if ("$type" in node && path.length && !Object.values(node).some((v) => isObject(v) && ("$value" in v || "$type" in v))) {
    gaps.add(`${doc.label}: "${path.join(".")}" has a $type but no value; skipped.`);
  }
  for (const [key, child] of Object.entries(node)) {
    if (key.startsWith("$") || !isObject(child)) continue;
    if (token) gaps.add(`${doc.label}: some tokens also contain child tokens, which the spec forbids; both are read.`);
    collect(child, [...path, key], type, doc, out, gaps, options);
  }
}

function modeValues(raw: RawToken, options: DtcgOptions): Record<string, unknown> {
  const ext = raw.node.$extensions as Record<string, unknown> | undefined;
  const modes = options.modesExtension ? (ext?.[options.modesExtension] as Record<string, unknown> | undefined) : undefined;
  if (modes && typeof modes === "object") return modes;
  return { [DEFAULT_MODE]: raw.node.$value };
}

function resolve(
  value: unknown,
  raw: RawToken,
  mode: string,
  byPath: Map<string, RawToken>,
  options: DtcgOptions,
  seen: Set<string>,
): TokenValue {
  // Alias: "{group.token}"
  if (typeof value === "string" && /^\{[^}]+\}$/.test(value)) {
    const target = value.slice(1, -1);
    const ref = byPath.get(target);
    if (!ref) return { kind: "unresolved", text: value, reason: "alias target not found" };
    if (seen.has(target)) return { kind: "unresolved", text: value, reason: "alias cycle" };
    seen.add(target);
    const refModes = modeValues(ref, options);
    const next = mode in refModes ? refModes[mode] : refModes[DEFAULT_MODE];
    return resolve(next, ref, mode, byPath, options, seen);
  }
  // Alias with an alpha modifier: { value: "{black.default}", alpha: 0.6 } (not in the spec).
  if (isObject(value) && "value" in value && "alpha" in value && typeof value.alpha === "number") {
    const base = resolve(value.value, raw, mode, byPath, options, seen);
    if (base.kind !== "color") return { kind: "unresolved", text: JSON.stringify(value), reason: "alpha applied to a non-colour" };
    return { kind: "color", color: { ...base.color, a: base.color.a * value.alpha } };
  }

  switch (raw.type) {
    case "color": {
      const color = parseColor(value);
      return color ? { kind: "color", color } : { kind: "unresolved", text: JSON.stringify(value), reason: "unsupported colour value" };
    }
    case "dimension": {
      const custom = options.dimension?.(value, raw);
      if (custom) return custom;
      return parseDimension(value, options.remBase ?? 16);
    }
    case "number":
    case "fontWeight":
      return typeof value === "number" ? { kind: "number", value } : { kind: "unresolved", text: JSON.stringify(value), reason: "not a number" };
    default:
      return { kind: "unresolved", text: JSON.stringify(value), reason: `type "${raw.type ?? "unknown"}" is not read yet` };
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** DTCG 2025.10 colour objects, and legacy hex strings. Only sRGB is accepted. */
export function parseColor(value: unknown): Color | undefined {
  if (isObject(value)) {
    const components = value.components;
    if (value.colorSpace !== "srgb" || !Array.isArray(components) || components.length !== 3) {
      return typeof value.hex === "string" ? parseColor(value.hex) : undefined;
    }
    const [r, g, b] = components as number[];
    return { space: "srgb", r: r!, g: g!, b: b!, a: typeof value.alpha === "number" ? value.alpha : 1 };
  }
  if (typeof value === "string") {
    const m = /^#([0-9a-f]{3,8})$/i.exec(value.trim());
    if (!m) return undefined;
    let hex = m[1]!;
    if (hex.length === 3 || hex.length === 4) hex = [...hex].map((c) => c + c).join("");
    if (hex.length !== 6 && hex.length !== 8) return undefined;
    const n = (i: number) => parseInt(hex.slice(i, i + 2), 16) / 255;
    return { space: "srgb", r: n(0), g: n(2), b: n(4), a: hex.length === 8 ? n(6) : 1 };
  }
  return undefined;
}

/** DTCG 2025.10 `{ value, unit }`, and legacy strings like "16px" or "1rem". */
export function parseDimension(value: unknown, remBase: number): TokenValue {
  let amount: number | undefined;
  let unit: string | undefined;
  if (isObject(value) && typeof value.value === "number" && typeof value.unit === "string") {
    amount = value.value;
    unit = value.unit;
  } else if (typeof value === "string") {
    const m = /^(-?\d*\.?\d+)(px|rem)$/.exec(value.trim());
    if (m) {
      amount = Number(m[1]);
      unit = m[2];
    } else if (value.trim() === "0") {
      return { kind: "dimension", points: 0 };
    }
  }
  if (amount === undefined) {
    const reason = typeof value === "number" ? "bare number without a unit" : "not a fixed length (e.g. viewport-relative)";
    return { kind: "unresolved", text: JSON.stringify(value), reason };
  }
  if (unit === "px") return { kind: "dimension", points: amount };
  if (unit === "rem") return { kind: "dimension", points: amount * remBase };
  return { kind: "unresolved", text: JSON.stringify(value), reason: `unit "${unit}"` };
}
