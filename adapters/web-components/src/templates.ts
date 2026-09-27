// Heuristic: slot names from compiled Lit templates (html`…<slot name="x">…`).
// A regex over template text, not a parse; the index marks these slots as medium confidence.
// tree-sitter's html-in-js injection is the planned replacement.

const SLOT_TAG = /<slot\b([^>]*)>/g;
const NAME_ATTR = /\bname\s*=\s*(["'])([^"'$]*)\1/;

/** Slot names found in a module's templates; "" is the default slot. Dynamic names are skipped. */
export function scanSlots(source: string): string[] {
  const names = new Set<string>();
  for (const m of source.matchAll(SLOT_TAG)) {
    const attrs = m[1] ?? "";
    const name = NAME_ATTR.exec(attrs);
    if (name) names.add(name[2]!);
    else if (!/\bname\s*=/.test(attrs)) names.add("");
  }
  return [...names];
}
