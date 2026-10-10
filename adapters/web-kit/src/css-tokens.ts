// Design tokens declared as CSS custom properties: `:root { --color-primary: #4f46e5 }`.
//
// Many design systems publish no DTCG files; their tokens exist only as custom properties in
// the stylesheet they ship. Each property declared on a theme selector becomes a token, its
// value resolved through var() references, per mode. Properties whose value is not a colour,
// length or number (shadows, fonts, easing) are kept as "unresolved", never guessed.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseColor, type Color, type DesignToken, type TokenValue } from "@tulpar/core";

export interface CssTokenConfig {
  /** Stylesheets that declare the tokens, relative to the project root. */
  files: string[];
  /** Only properties starting with this prefix (without "--"), e.g. "sl" for --sl-color-primary-600. */
  prefix?: string;
  /**
   * Mode name → selector that declares it, e.g. { "dark": ".sl-theme-dark" }.
   * `:root`, `:host` and `html` always declare the "default" mode.
   */
  modes?: Record<string, string>;
  /** Pixels per rem (default 16). */
  remBase?: number;
}

const DEFAULT_SELECTORS = new Set([":root", ":host", "html"]);

export function readCssTokens(root: string, config: CssTokenConfig): { tokens: DesignToken[]; modes: string[]; gaps: string[] } {
  const gaps: string[] = [];
  const modeOf = new Map<string, string>([...DEFAULT_SELECTORS].map((s) => [s, "default"]));
  for (const [mode, selector] of Object.entries(config.modes ?? {})) modeOf.set(normSelector(selector), mode);
  const prefix = config.prefix ? `--${config.prefix}-` : "--";

  // mode → property → raw value; later declarations win, as in the cascade.
  const raw = new Map<string, Map<string, { value: string; file: string }>>();
  for (const file of config.files) {
    const path = join(root, file);
    if (!existsSync(path)) {
      gaps.push(`Token stylesheet not found: ${file}`);
      continue;
    }
    const css = readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    // Innermost blocks only: at-rule wrappers (@media, @layer) are looked through.
    for (const block of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selectors = block[1]!.split(",").map(normSelector);
      let modes = [...new Set(selectors.map((s) => modeOf.get(s)).filter((m): m is string => !!m))];
      // A theme block that also names ":host" (for shadow roots) sets that theme, not the default;
      // only ":root" or "html" make it the default as well.
      if (modes.some((m) => m !== "default") && !selectors.some((s) => s === ":root" || s === "html")) modes = modes.filter((m) => m !== "default");
      if (!modes.length) continue;
      for (const d of block[2]!.matchAll(/(--[a-zA-Z0-9_-]+)\s*:\s*([^;]+?)\s*(?:;|$)/g)) {
        if (!d[1]!.startsWith(prefix)) continue;
        for (const mode of modes) {
          if (!raw.has(mode)) raw.set(mode, new Map());
          raw.get(mode)!.set(d[1]!, { value: d[2]!, file });
        }
      }
    }
  }
  if (!raw.has("default") && raw.size) gaps.push("No custom properties on :root, :host or html; only theme selectors declare tokens.");

  const modes = ["default", ...[...raw.keys()].filter((m) => m !== "default")].filter((m) => raw.has(m));
  const names = new Set([...raw.values()].flatMap((m) => [...m.keys()]));
  const remBase = config.remBase ?? 16;
  const tokens: DesignToken[] = [];
  for (const property of [...names].sort()) {
    const values: Record<string, TokenValue> = {};
    let file = "";
    for (const mode of modes) {
      const own = raw.get(mode)!.get(property) ?? raw.get("default")?.get(property);
      if (!own) continue;
      file ||= own.file;
      values[mode] = parseCssValue(resolveVars(own.value, mode, raw), remBase);
    }
    const kinds = new Set(Object.values(values).map((v) => v.kind));
    const type = kinds.has("color") ? "color" : kinds.has("dimension") ? "dimension" : kinds.has("number") ? "number" : "other";
    const name = property.slice(2);
    tokens.push({
      name,
      path: name.split("-"),
      type,
      values,
      codeRef: `var(${property})`,
      // Declared in the stylesheet the components ship, so the name is what code uses.
      codeRefConfirmed: true,
      provenance: { source: `css:${file}`, confidence: "high" },
    });
  }
  return { tokens, modes, gaps };
}

function normSelector(s: string): string {
  return s.trim().replace(/\s+/g, " ");
}

/** Substitutes var(--x[, fallback]) with the value declared for this mode (or the default). */
function resolveVars(value: string, mode: string, raw: Map<string, Map<string, { value: string }>>, depth = 0): string {
  if (depth > 10 || !value.includes("var(")) return value;
  return resolveVars(
    value.replace(/var\(\s*(--[a-zA-Z0-9_-]+)\s*(?:,\s*([^()]*(?:\([^()]*\))?[^()]*))?\)/g, (whole, name: string, fallback?: string) => {
      const found = raw.get(mode)?.get(name) ?? raw.get("default")?.get(name);
      return found ? found.value : fallback !== undefined ? fallback.trim() : whole;
    }),
    mode,
    raw,
    depth + 1,
  );
}

export function parseCssValue(value: string, remBase = 16): TokenValue {
  const v = value.trim();
  const color = cssColor(v);
  if (color) return { kind: "color", color };
  const len = /^(-?\d*\.?\d+)(px|rem)$/.exec(v);
  if (len) return { kind: "dimension", points: Number(len[1]) * (len[2] === "rem" ? remBase : 1) };
  if (v === "0") return { kind: "dimension", points: 0 };
  if (/^-?\d*\.?\d+$/.test(v)) return { kind: "number", value: Number(v) };
  return { kind: "unresolved", text: v, reason: v.includes("var(") ? "refers to a property not declared on a theme selector" : "not a colour, length or number" };
}

const NAMED: Record<string, string> = { white: "#ffffff", black: "#000000", transparent: "#00000000" };

/** CSS colours: hex, rgb()/rgba(), hsl()/hsla() (comma or space syntax), and a few names. */
export function cssColor(value: string): Color | undefined {
  const v = value.trim().toLowerCase();
  if (NAMED[v]) return parseColor(NAMED[v]);
  if (v.startsWith("#")) return parseColor(v);
  const m = /^(rgba?|hsla?)\(\s*([^)]+)\)$/.exec(v);
  if (!m) return undefined;
  const parts = m[2]!.split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3) return undefined;
  const alpha = parts[3] === undefined ? 1 : parts[3].endsWith("%") ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]);
  if (m[1]!.startsWith("rgb")) {
    const c = parts.slice(0, 3).map((p) => (p.endsWith("%") ? parseFloat(p) / 100 : parseFloat(p) / 255));
    if (c.some(Number.isNaN)) return undefined;
    return { space: "srgb", r: c[0]!, g: c[1]!, b: c[2]!, a: alpha };
  }
  const h = (((parseFloat(parts[0]!) % 360) + 360) % 360) / 360;
  const s = parseFloat(parts[1]!) / 100;
  const l = parseFloat(parts[2]!) / 100;
  if ([h, s, l].some(Number.isNaN)) return undefined;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = (t: number) => {
    t = (t + 1) % 1;
    return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p;
  };
  return { space: "srgb", r: hue(h + 1 / 3), g: hue(h), b: hue(h - 1 / 3), a: alpha };
}
