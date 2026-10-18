// A stylesheet as CSS, whatever it was written in: CSS as is, SCSS and LESS compiled. The static checks read
// the compiled CSS, so a value hidden in a $variable or a function is still seen as hard-coded.

import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import less from "less";
import * as sass from "sass";

export function readStylesheet(path: string): string {
  if (/\.scss$/.test(path)) return sass.compile(path, { style: "expanded", loadPaths: [dirname(path)] }).css;
  if (/\.less$/.test(path)) return compileLess(readFileSync(path, "utf8"), path);
  return readFileSync(path, "utf8");
}

/** LESS to CSS, synchronously (with syncImport, less calls back before render returns). */
export function compileLess(source: string, filename: string): string {
  let css: string | undefined;
  let error: Error | undefined;
  less.render(source, { filename, syncImport: true, paths: [dirname(filename)] }, (err, out) => {
    if (err) error = new Error(err.message);
    else css = out?.css;
  });
  if (error) throw error;
  if (css === undefined) throw new Error(`LESS did not compile ${filename}`);
  return css;
}
