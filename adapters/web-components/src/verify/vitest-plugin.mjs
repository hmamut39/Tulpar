// A Vite plugin for running Web Components specs in Vitest browser mode: an implementation file
// (Name.html) imports as a module whose mount() puts its style and markup into the page, after its
// module scripts (which import and define the design-system elements) and the project's setup have run.
import { parseImplementation } from "./impl.ts";

export function tulparWebComponents(setup) {
  return {
    name: "tulpar-web-components",
    enforce: "pre",
    transform(code, id) {
      const file = id.split("?")[0];
      if (!file.endsWith(".html")) return null;
      const impl = parseImplementation(code);
      const css = impl.styles.map((s) => s.css).join("\n");
      return {
        code: [
          ...(setup ? [`import ${JSON.stringify(setup)};`] : []),
          ...impl.scripts.map((s) => s.code),
          `const __markup = ${JSON.stringify(impl.markup)};`,
          `const __css = ${JSON.stringify(css)};`,
          `/** Puts the component into the page (document.body by default) and returns its host element. */`,
          `export function mount(target = document.body) {`,
          `  const host = document.createElement("div");`,
          `  host.innerHTML = (__css ? "<style>" + __css + "</style>" : "") + __markup;`,
          `  target.appendChild(host);`,
          `  return host;`,
          `}`,
          `export default mount;`,
        ].join("\n"),
        map: null,
      };
    },
  };
}
