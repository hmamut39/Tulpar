// The design's accent colour, and the design system's nearest accent palettes.
//
// Colours inside design-system components are the components' own business, so the token
// hints skip them. But one of them decides how the result looks: the accent (a primary
// button's fill). Design systems set it their own way (Radix's accentColor, Chakra's
// colorPalette, MUI's color, PrimeNG's severity), choosing among named palettes. So the
// accent is found in the design, and the palettes whose colours are closest (by OKLab
// distance, close to how different colours look) are offered by name.

import type { DesignToken, TokenSet } from "../code-model.ts";
import type { Color, DesignNode } from "../model.ts";

export interface AccentHint {
  /** The design's accent, #rrggbb. */
  color: string;
  /** Nearest palettes, best first: the family name, its closest step's token, and how far off it is. */
  options: { family: string; token: string; codeRef?: string; hex: string; distance: number }[];
}

// Families that are greys, surfaces or roles rather than accent palettes.
const NOT_ACCENTS = /^(gray|grey|neutral|slate|zinc|stone|mauve|sage|olive|sand|black|white|whitea|blacka|accent|bg|fg|border|text|surface|background|foreground|overlay|shadow|focus|panel|divider|action|common|contrast|light|dark|alpha)$/;

/** The most saturated colour covering the most area inside component instances, or undefined. */
export function findAccent(root: DesignNode): Color | undefined {
  const weights = new Map<string, { color: Color; weight: number }>();
  const add = (c: Color, area: number) => {
    const { s, l } = hsl(c);
    if (s < 0.35 || l < 0.18 || l > 0.82 || c.a < 0.5) return;
    const key = hex(c);
    const seen = weights.get(key) ?? { color: c, weight: 0 };
    seen.weight += area * s;
    weights.set(key, seen);
  };
  const visit = (n: DesignNode, inInstance: boolean) => {
    if (!n.visible) return;
    const inside = inInstance || n.kind === "instance";
    if (inside && n.box) for (const p of n.fills) if (p.kind === "solid") add({ ...p.color, a: p.color.a * p.opacity }, n.box.width * n.box.height);
    if (n.kind !== "text") for (const c of n.children) visit(c, inside);
    // Content placed into a component (a button inside a card) is a component's content, not its layers.
    if (n.kind === "instance") for (const c of n.content ?? []) visit(c, false);
  };
  visit(root, false);
  return [...weights.values()].sort((a, b) => b.weight - a.weight)[0]?.color;
}

export function accentHint(root: DesignNode, set: TokenSet, mode: string, max = 3): AccentHint | undefined {
  const accent = findAccent(root);
  if (!accent) return undefined;
  const target = oklab(accent);
  const best = new Map<string, { token: DesignToken; hex: string; distance: number }>();
  for (const t of set.tokens) {
    if (t.type !== "color") continue;
    const family = familyOf(t.name);
    if (!family) continue;
    const v = t.values[mode] ?? t.values.default;
    if (v?.kind !== "color" || v.color.a < 0.9) continue;
    const distance = deltaE(target, oklab(v.color));
    const seen = best.get(family);
    if (!seen || distance < seen.distance) best.set(family, { token: t, hex: hex(v.color), distance });
  }
  const options = [...best]
    .sort((a, b) => a[1].distance - b[1].distance)
    .slice(0, max)
    .map(([family, { token, hex: h, distance }]) => ({ family, token: token.name, ...(token.codeRef && { codeRef: token.codeRef }), hex: h, distance: Math.round(distance * 10) / 10 }));
  return options.length ? { color: hex(accent), options } : undefined;
}

/**
 * The palette a colour token belongs to: "blue" for blue-9 (Radix), chakra-colors-blue-500,
 * p-blue-500 (PrimeNG) or mui-palette-info-main; undefined for greys, roles and other tokens.
 */
export function familyOf(name: string): string | undefined {
  const n = name.toLowerCase();
  const m = /(?:^|-)(?:colou?rs?-|palette-)?([a-z]+)-(\d{1,3}|main)$/.exec(n);
  if (!m) return undefined;
  const family = m[1]!;
  if (NOT_ACCENTS.test(family) || family.length < 3) return undefined;
  return family;
}

function hex(c: Color): string {
  return `#${[c.r, c.g, c.b].map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("")}`;
}

function hsl(c: Color): { s: number; l: number } {
  const max = Math.max(c.r, c.g, c.b);
  const min = Math.min(c.r, c.g, c.b);
  const l = (max + min) / 2;
  const d = max - min;
  return { s: d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1)), l };
}

/** OKLab, ×100 so distances read like ΔE. */
function oklab(c: Color): [number, number, number] {
  const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = [lin(c.r), lin(c.g), lin(c.b)];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [100 * (0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s), 100 * (1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s), 100 * (0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s)];
}

function deltaE(a: [number, number, number], b: [number, number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

// Props through which design systems choose a component's colour.
const COLOUR_PROP = /^(color|colorPalette|colorScheme|severity|accentColor|tone|intent)$/i;

/** Roles some design systems name colours by, chosen by the accent's hue. */
export function roleFor(color: string): string | undefined {
  const c = parseHex(color);
  const max = Math.max(c.r, c.g, c.b);
  const min = Math.min(c.r, c.g, c.b);
  if (max - min < 0.08) return undefined;
  const d = max - min;
  let h = max === c.r ? ((c.g - c.b) / d) % 6 : max === c.g ? (c.b - c.r) / d + 2 : (c.r - c.g) / d + 4;
  h = (h * 60 + 360) % 360;
  if (h < 20 || h >= 340) return "danger";
  if (h < 65) return "warn";
  if (h < 160) return "success";
  if (h < 250) return "info";
  return "help";
}

const ROLE_SYNONYMS: Record<string, string[]> = { danger: ["danger", "error", "critical", "negative"], warn: ["warn", "warning", "caution"], success: ["success", "positive"], info: ["info", "informative"], help: ["help"] };

/** Whether a node (or anything inside it) is painted in the accent colour. */
export function carriesAccent(n: DesignNode, accent: string): boolean {
  const target = oklab(parseHex(accent));
  const visit = (x: DesignNode): boolean => {
    if (!x.visible) return false;
    if (x.fills.some((p) => p.kind === "solid" && deltaE(target, oklab(p.color)) < 12)) return true;
    return x.kind !== "text" && x.children.some(visit);
  };
  return visit(n);
}

/**
 * The prop and value that give a component the design's accent, from its real API: a colour prop
 * whose allowed values include the nearest palette ("cyan") or, failing that, the accent's role ("info").
 */
export function accentProp(props: { name: string; type?: { kind: string; values?: (string | number)[] } }[], accent: AccentHint): { prop: string; value: string } | undefined {
  const role = roleFor(accent.color);
  for (const p of props) {
    if (!COLOUR_PROP.test(p.name) || p.type?.kind !== "enum" || !p.type.values?.length) continue;
    const values = p.type.values.map(String);
    const family = accent.options.map((o) => o.family).find((f) => values.includes(f));
    if (family) return { prop: p.name, value: family };
    const roleValue = role && ROLE_SYNONYMS[role]!.find((r) => values.includes(r));
    if (roleValue) return { prop: p.name, value: roleValue };
  }
  return undefined;
}

function parseHex(h: string): Color {
  return { space: "srgb", r: parseInt(h.slice(1, 3), 16) / 255, g: parseInt(h.slice(3, 5), 16) / 255, b: parseInt(h.slice(5, 7), 16) / 255, a: 1 };
}

/** The design system's colour token nearest to a hex colour, in any mode (OKLab ΔE ×100). */
export function nearestColorToken(color: string, set: TokenSet): { name: string; hex: string; distance: number; codeRef?: string } | undefined {
  const target = oklab(parseHex(color));
  let best: { name: string; hex: string; distance: number; codeRef?: string } | undefined;
  for (const t of set.tokens) {
    if (t.type !== "color") continue;
    for (const v of Object.values(t.values)) {
      if (v?.kind !== "color" || v.color.a < 0.9) continue;
      const distance = deltaE(target, oklab(v.color));
      if (!best || distance < best.distance) best = { name: t.name, hex: hex(v.color), distance: Math.round(distance * 10) / 10, ...(t.codeRef && { codeRef: t.codeRef }) };
    }
  }
  return best;
}
