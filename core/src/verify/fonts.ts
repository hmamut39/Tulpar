// The broad class of a typeface: what a screenshot can show when it cannot name the font.

export type FontClass = "sans-serif" | "serif" | "monospace";

// Common faces whose names do not say their class. Lower-case.
const SERIF = new Set([
  "times", "times new roman", "georgia", "cambria", "garamond", "palatino", "palatino linotype", "book antiqua", "baskerville",
  "liberation serif", "dejavu serif", "noto serif", "tinos", "merriweather", "lora", "playfair display", "source serif pro",
  "source serif 4", "ibm plex serif", "pt serif", "crimson text", "libre baskerville", "charter", "constantia", "didot", "bodoni",
]);
const MONO = new Set([
  "courier", "courier new", "consolas", "menlo", "monaco", "lucida console", "andale mono", "liberation mono", "dejavu sans mono",
  "noto sans mono", "cousine", "fira code", "fira mono", "jetbrains mono", "source code pro", "ibm plex mono", "sf mono",
  "roboto mono", "ubuntu mono", "cascadia code", "cascadia mono", "inconsolata",
]);

/** The class of a font family name, from a list of common faces, then from words in its name. */
export function fontClass(family: string): FontClass {
  const f = family.trim().replace(/^["']|["']$/g, "").toLowerCase();
  if (f === "serif") return "serif";
  if (f === "monospace") return "monospace";
  if (MONO.has(f) || /\b(mono|code|courier|console)\b/.test(f)) return "monospace";
  if (SERIF.has(f) || (/\bserif\b/.test(f) && !/\bsans\b/.test(f))) return "serif";
  return "sans-serif";
}
