// What a token is for, read from its name and type, and which style properties it suits.
// A font-size token used as padding has the right value by accident: change the type scale and
// the padding moves. The check only flags what it can tell; a token whose name says nothing
// about its kind is never flagged.

import type { DesignProperty } from "./types.ts";

export type TokenKind =
  | "color"
  | "font-size"
  | "line-height"
  | "font-weight"
  | "font-family"
  | "letter-spacing"
  | "spacing"
  | "radius"
  | "border-width"
  | "size"
  | "shadow"
  | "motion"
  | "z-index"
  | "opacity";

// Order matters: the first match wins ("font-size" before "size", "border-width" before "width").
const KINDS: [RegExp, TokenKind][] = [
  [/font-?size|text-?size|type-?size/, "font-size"],
  [/line-?height|leading/, "line-height"],
  [/font-?weight|(^|-)weight(-|$)/, "font-weight"],
  [/font-?family|(^|-)font-(sans|serif|mono)(-|$)/, "font-family"],
  [/letter-?spacing|tracking/, "letter-spacing"],
  [/radius|rounded|corner/, "radius"],
  [/border-?width|stroke-?width|outline-?width/, "border-width"],
  [/shadow|elevation/, "shadow"],
  [/duration|easing|transition|motion|delay|animation/, "motion"],
  [/z-?index|(^|-)z-(?=\w)/, "z-index"],
  [/opacity/, "opacity"],
  [/spacing|space|gap|gutter|inset|padding|margin/, "spacing"],
  [/colou?r|background|foreground|(^|-)(bg|fg)(-|$)/, "color"],
  [/size|width|height/, "size"],
];

export function tokenKind(name: string, type?: string): TokenKind | undefined {
  const n = name.toLowerCase();
  for (const [re, kind] of KINDS) if (re.test(n)) return kind;
  if (type === "color") return "color";
  return undefined;
}

/**
 * The kinds that suit a property. Absent: the property is not judged (borders: the shorthand
 * mixes width and colour tokens legitimately).
 */
export const SUITS: Partial<Record<DesignProperty, TokenKind[]>> = {
  fill: ["color"],
  textColor: ["color"],
  fontFamily: ["font-family"],
  fontSize: ["font-size"],
  fontWeight: ["font-weight"],
  lineHeight: ["line-height"],
  letterSpacing: ["letter-spacing"],
  gap: ["spacing", "size"],
  padding: ["spacing", "size"],
  margin: ["spacing", "size"],
  offset: ["spacing", "size"],
  radius: ["radius"],
  size: ["size", "spacing"],
};

/**
 * Why a token does not suit a property, or undefined when it does or the kind cannot be told.
 * `available` is the kinds the design system has tokens of: a property is only held to kinds
 * that exist, so a system without line-height tokens is never told to use one.
 */
export function wrongKind(property: DesignProperty, token: string, type: string | undefined, available: Set<TokenKind>): string | undefined {
  const suits = SUITS[property];
  const kind = tokenKind(token, type);
  if (!suits || !kind || suits.includes(kind)) return undefined;
  const existing = suits.filter((k) => available.has(k));
  if (!existing.length) return undefined;
  return `a ${kind} token used for ${property}; use a ${existing.join(" or ")} token`;
}

/** What a colour token colours, when its name says so: border-strong-01, text-secondary, layer-02. */
export type ColorRole = "border" | "text" | "background";
const ROLES: [RegExp, ColorRole][] = [
  [/(^|-)(border|stroke|outline|divider)(-|$)/, "border"],
  [/(^|-)(text|foreground|fg)(-|$)/, "text"],
  [/(^|-)(background|bg|layer|surface|field)(-|$)/, "background"],
];
export function colorRole(name: string): ColorRole | undefined {
  const n = name.toLowerCase();
  return ROLES.find(([re]) => re.test(n))?.[1];
}

/**
 * Why a colour token's role does not suit a property: a border or background colour used for text
 * (its value matches today; change the theme and the text follows the borders), or a border colour as
 * a fill. Text colours as fills are left alone: icons are filled with them. `names` are the design
 * system's tokens, to suggest one of the right role; only roles the system has are asked for.
 */
export function wrongRole(property: DesignProperty, token: string, names: string[]): string | undefined {
  const role = colorRole(token);
  if (!role) return undefined;
  const wrong = property === "textColor" ? role !== "text" : property === "fill" ? role === "border" : false;
  if (!wrong) return undefined;
  const want: ColorRole = property === "textColor" ? "text" : "background";
  const example = names.find((n) => colorRole(n) === want);
  if (!example) return undefined;
  return `a ${role} colour token used for ${property === "textColor" ? "text" : "a fill"}; use a ${want} colour token, e.g. ${example}`;
}

/**
 * Words a design system uses both as a component and for its global scales (Chakra's Text and Container, Element
 * Plus's Space, Carbon's Layer and Heading): a token that starts with one is not taken to be that component's.
 */
const GENERIC = new Set(["text", "link", "icon", "space", "spacer", "layout", "container", "grid", "stack", "box", "flex", "row", "col", "column", "divider", "heading", "layer", "theme", "border", "shadow", "typography", "font", "color", "size", "sizes", "radius", "spacing", "z-index", "transition", "base"]);

/** "ElMenuItem" → "el-menu-item". */
const kebab = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/[_\s.]+/g, "-").toLowerCase();

/** The leading word most token names share (el, cds, sl), so el-menu-… reads as the menu's. */
export function tokenPrefix(names: string[]): string | undefined {
  const counts = new Map<string, number>();
  for (const n of names) {
    const first = /^-*([a-z0-9]+)-/.exec(n.toLowerCase())?.[1];
    if (first) counts.set(first, (counts.get(first) ?? 0) + 1);
  }
  const [word, count] = [...counts].sort((a, b) => b[1] - a[1])[0] ?? [];
  return word && count! > names.length / 2 ? word : undefined;
}

/** A component's name as a token would spell it, without the design system's prefix: ElMenu → "menu". */
export function componentWord(name: string, prefix?: string): string {
  const k = kebab(name.replace(/^<|>$/g, ""));
  return prefix && k.startsWith(`${prefix}-`) ? k.slice(prefix.length + 1) : k;
}

/** The design-system component a token belongs to, when its name says so: el-menu-base-level-padding → "menu". */
export function tokenComponent(token: string, words: Set<string>, prefix?: string): string | undefined {
  let rest = token.toLowerCase().replace(/^-+/, "");
  if (prefix && rest.startsWith(`${prefix}-`)) rest = rest.slice(prefix.length + 1);
  let best: string | undefined;
  for (const w of words) if (!GENERIC.has(w) && (rest === w || rest.startsWith(`${w}-`)) && w.length > (best?.length ?? 0)) best = w;
  return best;
}

/** Properties a component's own token is judged on: its spacing and sizes. Colours have roles (wrongRole). */
const SCOPED: DesignProperty[] = ["padding", "margin", "gap", "offset", "size", "radius"];

/**
 * Why a token does not suit where it is used: another component's own value (a menu's padding on a card). The value
 * matches today; tune the menu and the card moves with it. `usedOn` is the components of the elements it was read
 * on; only judged when every one of them is another component (a button's token inside a button is its own).
 *  is the kinds the design system has tokens of that belong to no component: Element Plus has no spacing
 * scale, only its components' paddings, so borrowing one there is the best it allows and is not judged.
 */
export function otherComponent(property: DesignProperty, token: string, type: string | undefined, usedOn: string[], words: Set<string>, global: Set<TokenKind>, prefix?: string): string | undefined {
  if (!SCOPED.includes(property) || !usedOn.length) return undefined;
  const owner = tokenComponent(token, words, prefix);
  const kind = tokenKind(token, type);
  if (!owner || !kind || !global.has(kind)) return undefined;
  if (usedOn.some((c) => { const w = componentWord(c, prefix); return w === owner || w.startsWith(`${owner}-`); })) return undefined;
  return `the ${owner} component's own value used for ${property} here; use a global ${kind} token`;
}
