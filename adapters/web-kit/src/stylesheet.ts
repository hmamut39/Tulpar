// A stylesheet as CSS, whatever it was written in: CSS as is, SCSS compiled. The static checks read
// the compiled CSS, so a value hidden in a $variable or a function is still seen as hard-coded.

import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import * as sass from "sass";

export function readStylesheet(path: string): string {
  if (/\.scss$/.test(path)) return sass.compile(path, { style: "expanded", loadPaths: [dirname(path)] }).css;
  return readFileSync(path, "utf8");
}
