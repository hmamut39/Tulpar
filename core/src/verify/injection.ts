// The input filter: text in a design (its words and its layer names) that speaks to an AI, or asks for what a UI
// component never does. The model is told design text is content, never instructions, and the safety check scans
// the code it writes; this tells the person up front that their design carries such text, and where.

import type { DesignNode } from "../model.ts";

const ADDRESSED = [
  /\b(ignore|disregard|forget|override)\b[^.\n]{0,40}\b(instructions?|rules|previous|above|prompt|guidelines)\b/i,
  /\b(note|message|instructions?) (to|for) (the )?(ai|assistant|model|llm|agent|copilot)\b/i,
  /\b(you are|act as|pretend to be) (an? |the )?(ai|assistant|model|llm|agent)\b/i,
  /\b(ai|assistant|model|llm|agent) (writing|reading|generating) this\b/i,
  /(^|[\s.])(system|assistant)\s*:/i,
  /\bdo not (mention|tell|reveal|report) (this|it)\b/i,
];
const ASKS = [
  /\bdocument\.cookie\b|\blocalStorage\b|\bsessionStorage\b|\bindexedDB\b/,
  /\bfetch\s*\(|\bXMLHttpRequest\b|\bnavigator\.sendBeacon\b|\beval\s*\(|<script\b|\binnerHTML\b/i,
  /\b(send|post|upload|exfiltrate|leak)\b[^.\n]{0,60}\b(cookies?|tokens?|passwords?|keys?|secrets?|storage|credentials)\b/i,
];

export interface DesignInjection {
  id: string;
  /** The layer's name, shortened. */
  layer: string;
  where: "text" | "layer name";
  /** The words that matched, with a little around them. */
  excerpt: string;
}

const excerpt = (s: string, at: number) => {
  const from = Math.max(0, at - 30);
  return `${from > 0 ? "…" : ""}${s.slice(from, at + 70).replace(/\s+/g, " ").trim()}${at + 70 < s.length ? "…" : ""}`;
};

/** Every visible text and layer name in the design that addresses an AI or asks for what a component never does. */
export function scanDesign(root: DesignNode): DesignInjection[] {
  const found: DesignInjection[] = [];
  const visit = (n: DesignNode) => {
    const layer = n.name.length > 40 ? `${n.name.slice(0, 40)}…` : n.name;
    for (const [where, s] of [["layer name", n.name], ...(n.kind === "text" ? [["text", n.characters]] : [])] as ["text" | "layer name", string][]) {
      const hit = [...ADDRESSED, ...ASKS].map((r) => r.exec(s)).find((m) => m);
      if (hit) found.push({ id: n.id, layer, where, excerpt: excerpt(s, hit.index) });
    }
    if ("children" in n) for (const c of n.children) visit(c);
  };
  visit(root);
  return found;
}

/** The report's note for them, or undefined when the design has none. */
export function injectionNote(found: DesignInjection[]): string | undefined {
  if (!found.length) return undefined;
  const list = found.slice(0, 3).map((f) => `"${f.layer}" (${f.id}), in its ${f.where}: ${f.excerpt}`).join("; ");
  return `This design has ${found.length === 1 ? "text" : `${found.length} pieces of text`} that read${found.length === 1 ? "s" : ""} like instructions to an AI or asks for what a component never does: ${list}${found.length > 3 ? "; and more" : ""}. Tulpar treats design text as content and never follows it; the safety check scans the code for anything of the kind. If you did not put it there, someone may have tried to hijack an AI through this file.`;
}
