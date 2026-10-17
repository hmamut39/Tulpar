// A Vite plugin for running Svelte specs in Vitest browser mode: .svelte files compiled by the same
// compiler the render uses (the project's own), so the project needs no @sveltejs/vite-plugin-svelte.
import { compilerFor } from "../compile.ts";

export function tulparSvelte(root) {
  return {
    name: "tulpar-svelte",
    enforce: "pre",
    config() {
      // Svelte packages publish components under the "svelte" condition, and svelte itself has a browser
      // build. One runtime only: Vite must not pre-bundle a second copy of svelte for the components.
      return {
        resolve: { conditions: ["svelte", "browser", "module", "development"], dedupe: ["svelte"] },
        optimizeDeps: { exclude: ["svelte"] },
      };
    },
    async transform(code, id) {
      const file = id.split("?")[0];
      if (!file.endsWith(".svelte")) return null;
      const svelte = await compilerFor(root);
      const out = svelte.compile(code, { filename: file, generate: "client", css: "injected", dev: true });
      return { code: out.js.code, map: null };
    },
  };
}
