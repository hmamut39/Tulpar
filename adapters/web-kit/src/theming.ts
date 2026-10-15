// The CSS custom properties a component reads for theming, found in the design system's stylesheet:
// those declared on its class and its modifiers (.el-button, .el-button--primary). Setting them on the
// component is the library's documented way to give it a token its props don't offer.

const COLOUR_FIRST = /(bg|background|color|border|fill|text)/;

/** Custom properties declared on `.className` or `.className--modifier`, colour-related first. */
export function themingProperties(css: string, className: string): string[] {
  const own = new RegExp(String.raw`^\.${className.replace(/[^\w-]/g, "")}(--[\w-]+)?$`);
  const found = new Set<string>();
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = m[1]!.split(",").map((s) => s.trim());
    if (!selectors.some((s) => own.test(s))) continue;
    for (const d of m[2]!.matchAll(/(--[\w-]+)\s*:/g)) if (d[1]!.startsWith(`--${className}-`)) found.add(d[1]!);
  }
  return [...found].sort((a, b) => Number(!COLOUR_FIRST.test(a)) - Number(!COLOUR_FIRST.test(b)));
}
