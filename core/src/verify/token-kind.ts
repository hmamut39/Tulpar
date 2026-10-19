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
