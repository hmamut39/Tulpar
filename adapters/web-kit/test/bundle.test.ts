// The bundler handles the languages and stylesheets teams write in: JSX, CSS Modules, SCSS.

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bundle, readStylesheet } from "../src/index.ts";

// The first Sass compile loads the compiler, which is slow under the test runner.
describe("bundling the team's language and styling", { timeout: 60_000 }, () => {
  const dir = mkdtempSync(join(tmpdir(), "tulpar-bundle-"));
  // A stand-in for React's JSX runtime: the folder has no React installed.
  mkdirSync(join(dir, "node_modules", "react"), { recursive: true });
  writeFileSync(join(dir, "node_modules", "react", "package.json"), JSON.stringify({ name: "react", exports: { "./jsx-runtime": "./jsx-runtime.js" } }));
  writeFileSync(join(dir, "node_modules", "react", "jsx-runtime.js"), "export const jsx = () => null; export const jsxs = jsx; export const Fragment = 'f';\n");
  writeFileSync(join(dir, "Card.module.css"), ".root { display: grid; gap: var(--x-space, 8px); }\n");
  writeFileSync(join(dir, "Card.scss"), "$pad: var(--x-pad, 16px);\n.card { .title { padding: $pad; } }\n");
  writeFileSync(join(dir, "Card.jsx"), 'import styles from "./Card.module.css";\nimport "./Card.scss";\nexport default function Card() { return <div className={styles.root}><h2 className="title">Hi</h2></div>; }\n');

  it("compiles SCSS, keeps CSS Modules local, and accepts plain JSX", async () => {
    const out = await bundle({ code: 'import Card from "./Card.jsx";\nwindow.card = Card;\n', resolveDir: dir, sourcefile: "entry.jsx", outDir: join(dir, "out"), loader: "jsx" });
    expect(out.log).toEqual([]);
    expect(out.ok).toBe(true);
    // SCSS nesting compiled to plain CSS; the module's class renamed to something local.
    expect(out.css).toMatch(/\.card \.title\s*\{\s*padding: var\(--x-pad, 16px\);/);
    expect(out.css).toMatch(/\.Card_root[\w-]*\s*\{[^}]*gap: var\(--x-space, 8px\)/);
    expect(readFileSync(join(dir, "out", "bundle.js"), "utf8")).toMatch(/Card_root/);
  });

  it("reads SCSS compiled, so a value hidden in a variable is still visible to the checks", () => {
    writeFileSync(join(dir, "Hidden.scss"), "$gap: 12px;\n.x { gap: $gap; }\n");
    expect(readStylesheet(join(dir, "Hidden.scss"))).toMatch(/gap: 12px/);
  });

  it("builds styled-components for a project without it, with the project's own React", async () => {
    writeFileSync(join(dir, "node_modules", "react", "index.js"), "export const marker = 'THE-PROJECT-REACT'; export default { marker }; export const createElement = () => null; export const useContext = () => null; export const useRef = () => ({}); export const useMemo = (f) => f(); export const useState = (v) => [v, () => {}]; export const useEffect = () => {}; export const useLayoutEffect = () => {}; export const useInsertionEffect = () => {}; export const useDebugValue = () => {}; export const createContext = () => ({ Provider: null, Consumer: null }); export const forwardRef = (f) => f; export const Children = {}; export const isValidElement = () => false; export const cloneElement = (e) => e; export const Fragment = 'f';\n");
    writeFileSync(join(dir, "node_modules", "react", "package.json"), JSON.stringify({ name: "react", main: "index.js", exports: { ".": "./index.js", "./jsx-runtime": "./jsx-runtime.js" } }));
    const out = await bundle({ code: 'import styled from "styled-components";\nwindow.Box = styled.div`display: grid;`;\n', resolveDir: dir, sourcefile: "styled.jsx", outDir: join(dir, "out3"), loader: "jsx" });
    expect(out.log).toEqual([]);
    expect(out.ok).toBe(true);
    const js = readFileSync(join(dir, "out3", "bundle.js"), "utf8");
    expect(js).toMatch(/THE-PROJECT-REACT/);
    // Any other package the project lacks is still an error: only styling libraries fall back to Tulpar's.
    const missing = await bundle({ code: 'import x from "lodash-es";\nwindow.x = x;\n', resolveDir: dir, sourcefile: "m.js", outDir: join(dir, "out4"), loader: "js" });
    expect(missing.ok).toBe(false);
  });

  it("reports a stylesheet that does not compile as a build error", async () => {
    writeFileSync(join(dir, "Broken.scss"), ".x { color: $undefined; }\n");
    const out = await bundle({ code: 'import "./Broken.scss";\n', resolveDir: dir, sourcefile: "e.js", outDir: join(dir, "out2"), loader: "js" });
    expect(out.ok).toBe(false);
    expect(out.log.join()).toMatch(/Undefined variable/);
  });
});
