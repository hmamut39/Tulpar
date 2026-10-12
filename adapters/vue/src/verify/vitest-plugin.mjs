// A Vite plugin for running Vue specs in Vitest browser mode: .vue files compiled by the same
// compiler the render uses (so the project needs no @vitejs/plugin-vue), styles dropped (they
// don't matter to assertions about text and components).
import { transform } from "esbuild";
import { compileSfc } from "../sfc.ts";

export function tulparVue() {
  return {
    name: "tulpar-vue",
    enforce: "pre",
    config() {
      return { define: { __VUE_OPTIONS_API__: "true", __VUE_PROD_DEVTOOLS__: "false", __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: "false" } };
    },
    resolveId(id) {
      return /\?vue-style=\d+$/.test(id) ? `\0${id}` : null;
    },
    load(id) {
      return id.startsWith("\0") && /\?vue-style=\d+$/.test(id) ? "export default {};" : null;
    },
    async transform(code, id) {
      const [file, query = ""] = id.split("?");
      if (!file.endsWith(".vue")) return null;
      // A style block import, whatever path Vite resolved it to: styles play no part in the tests.
      if (/(^|&)vue-style=\d+/.test(query)) return { code: "export default {};", map: null };
      const out = await compileSfc(file, code);
      if (out.errors.length) throw new Error(out.errors.join("\n"));
      const js = await transform(out.code, { loader: out.loader, format: "esm", target: "es2022", sourcefile: file });
      return { code: js.code, map: null };
    },
  };
}
