// Reusable: the component shows its content through inputs, not the design's words written into its markup. A card
// with "Heirloom tomato" in its template is a picture of one product; with a productName input defaulting to it,
// it is the card for every product. The check reads the code: each piece of the design's own content that appears
// written in place, as markup text, is a failure, with the fix (an input whose default is that text).
//
// Content is the frame's own text layers, not labels inside design-system components (a button's "Save" is the
// interface's word), and not single words without digits. Written in place means as markup text in a template
// (>Heirloom tomato<), or as the argument of a widget that draws it (Text('Heirloom tomato'), new H2("…")); as a
// default value (productName = "Heirloom tomato", input("Heirloom tomato")) it is an input, which is right.

import type { DesignNode } from "../model.ts";
import type { SourceFile } from "./safety.ts";

export interface HardCoded {
  id: string;
  name: string;
  text: string;
  file: string;
  line: number;
}

const TEST = /[._-](test|spec)\.|Tests?\.(cs|java|kt)$|_test\.(dart|rs)$/i;

/** The frame's own content: visible text layers outside design-system instances, of two words or more, or with a digit. */
export function contentTexts(root: DesignNode): { id: string; name: string; text: string }[] {
  const out: { id: string; name: string; text: string }[] = [];
  const visit = (n: DesignNode) => {
    if (!n.visible || n.kind === "instance") return;
    if (n.kind === "text") {
      const text = n.characters.trim().replace(/\s+/g, " ");
      if (text.length >= 2 && (/\S\s+\S/.test(text) || /\d/.test(text))) out.push({ id: n.id, name: n.name, text });
      return;
    }
    if ("children" in n) for (const c of n.children) visit(c);
  };
  visit(root);
  return out;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+");

/** Where each piece of content is written in place in the component's (not its tests') files. */
export function hardCodedContent(root: DesignNode, sources: SourceFile[]): HardCoded[] {
  const found: HardCoded[] = [];
  const code = sources.filter((s) => !TEST.test(s.path));
  for (const t of contentTexts(root)) {
    const e = escape(t.text);
    // Markup text (HTML, JSX, Vue, Svelte, Angular, Razor; Leptos quotes it), a JSX string child, or a widget's argument.
    const inPlace = new RegExp(`>\\s*"?${e}"?\\s*<|\\{\\s*["'\`]${e}["'\`]\\s*\\}|\\bText\\(\\s*["']${e}["']|\\bnew\\s+\\w+\\(\\s*"${e}"`);
    for (const s of code) {
      const m = inPlace.exec(s.content);
      if (!m) continue;
      found.push({ id: t.id, name: t.name, text: t.text, file: s.path, line: s.content.slice(0, m.index).split("\n").length + (m[0].startsWith(">") && m[0].slice(1).match(/^\s*\n/) ? 1 : 0) });
      break;
    }
  }
  return found;
}
