// CSS declarations → design-term style facts. Shared by the runtime (CDP) and static scans.

import type { DesignProperty, StyleFact } from "@tulpar/core";

const PROPERTY: [RegExp, DesignProperty][] = [
  [/^color$/, "textColor"],
  [/^(background|background-color|fill)$/, "fill"],
  [/^(border(-(top|right|bottom|left))?(-color)?|outline(-color)?|stroke)$/, "strokeColor"],
  [/^(font|font-size)$/, "fontSize"],
  [/^font-family$/, "fontFamily"],
  [/^font-weight$/, "fontWeight"],
  [/^line-height$/, "lineHeight"],
  [/^letter-spacing$/, "letterSpacing"],
  [/^(gap|row-gap|column-gap)$/, "gap"],
  [/^padding(-(top|right|bottom|left|inline|block)(-(start|end))?)?$/, "padding"],
  [/^margin(-(top|right|bottom|left|inline|block)(-(start|end))?)?$/, "margin"],
  [/^border(-(top|bottom)-(left|right))?-radius$/, "radius"],
  [/^(top|right|bottom|left|inset|translate|transform)$/, "offset"],
  [/^((min-|max-)?(width|height|inline-size|block-size))$/, "size"],
];

export function designProperty(cssProperty: string): DesignProperty | undefined {
  const name = cssProperty.trim().toLowerCase();
  return PROPERTY.find(([re]) => re.test(name))?.[1];
}

const COLOR_LITERAL = /^#[0-9a-f]{3,8}$|^(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i;
// The CSS named colours people actually hard-code; transparent and currentColor are keywords.
const NAMED_COLORS = new Set(["black", "white", "red", "green", "blue", "gray", "grey", "yellow", "orange", "purple", "pink", "brown", "navy", "teal", "silver", "maroon", "olive", "lime", "aqua", "fuchsia", "cyan", "magenta", "gold", "indigo", "violet", "crimson", "coral", "salmon", "tomato", "lightgray", "lightgrey", "darkgray", "darkgrey", "whitesmoke", "gainsboro"]);

const KEYWORD = /^(inherit|initial|unset|revert|revert-layer|auto|none|normal|transparent|currentcolor|0|0px|0rem|0%|100%|50%|solid|dashed|dotted)$/i;

/**
 * Classify one declaration. A value that goes through `var(--prefix-name)` is a
 * token, even with a fallback. Values made only of keywords are neutral. Anything
 * else with a number or colour in it is hard-coded.
 */
export function classify(cssProperty: string, value: string, prefix: string, at?: string): StyleFact | undefined {
  const property = designProperty(cssProperty);
  if (!property) return undefined;
  const written = value.trim().replace(/\s*!important$/i, "");
  const vars = [...written.matchAll(/var\(\s*--([a-zA-Z0-9-]+)/g)].map((m) => m[1]!);
  // Strip var(...) (including fallbacks) and see what is written outside it.
  const outside = stripVars(written);
  const parts = outside.split(/[\s,/]+/).filter(Boolean);
  // In colour properties only colours count: the 1px in "border: 1px solid var(--c)" is a width, not a colour.
  const isColor = property === "fill" || property === "textColor" || property === "strokeColor";
  const literal = parts.filter(
    (p) => !KEYWORD.test(p) && (isColor ? COLOR_LITERAL.test(p) || NAMED_COLORS.has(p.toLowerCase()) : /[0-9#]|rgb|hsl|lab|lch|oklch|color\(/i.test(p)),
  );
  const base = { property, written, ...(at && { at }) };
  if (literal.length) return { ...base, source: "literal" };
  // calc(var(--spacing-13) * 4) is a hard-coded 640px wearing a token: arithmetic on tokens is not a token.
  if (vars.length && /calc\(/i.test(written) && /[*/]/.test(outside)) return { ...base, source: "literal" };
  if (vars.length) {
    const name = vars[0]!;
    return { ...base, source: "token", token: prefix && name.startsWith(`${prefix}-`) ? name.slice(prefix.length + 1) : name };
  }
  return { ...base, source: "keyword" };
}

function stripVars(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; i++) {
    if (value.startsWith("var(", i)) {
      let depth = 0;
      for (; i < value.length; i++) {
        if (value[i] === "(") depth++;
        else if (value[i] === ")" && --depth === 0) break;
      }
      out += " ";
      continue;
    }
    out += value[i];
  }
  return out;
}

/** `prop: value;` pairs in a CSS text, with the 1-based line each starts on. */
export function declarations(css: string, firstLine = 1): { property: string; value: string; line: number }[] {
  const out: { property: string; value: string; line: number }[] = [];
  const text = css.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "));
  for (const m of text.matchAll(/(?:^|[{;\s])(-?[a-zA-Z][a-zA-Z0-9-]*)\s*:\s*([^;{}]+?)\s*(?=;|}|$)/g)) {
    const index = m.index! + m[0].indexOf(m[1]!);
    // Skip selectors with pseudo-classes such as "a:hover {": no value follows a real selector's colon before "{".
    if (/^[a-z-]+$/i.test(m[2]!) && text.slice(index + m[0].length).trimStart().startsWith("{")) continue;
    out.push({ property: m[1]!, value: m[2]!, line: firstLine + text.slice(0, index).split("\n").length - 1 });
  }
  return out;
}
