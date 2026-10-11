// tulpar init [dir] [--figma <file URL or key>] [--package <name>] [--adapter react|angular|web-components] [--force]
//
// Points Tulpar at a team's own design system: finds the framework, the design-system package,
// its tokens (DTCG files or CSS custom properties, with theme selectors as modes), stylesheets
// and Code Connect files; writes tulpar.json; then runs the adapter to show what it understood.
// Every guess is printed with its evidence, so a wrong one is easy to correct in the file.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import { parseFigmaUrl } from "@tulpar/core";
import { loadProject, withAdapter } from "./project.ts";

export interface InitOptions {
  figma?: string;
  package?: string;
  adapter?: string;
  force?: boolean;
  /** Skip running the adapter afterwards (tests). */
  noCheck?: boolean;
}

type Adapter = "react" | "angular" | "web-components";

export interface Detected {
  adapter: Adapter;
  why: string[];
  config: Record<string, unknown>;
  /** Files to create next to tulpar.json (a setup file), never overwriting one that exists. */
  files: Record<string, string>;
}

/**
 * Libraries that build their theme in JavaScript when their provider starts: nothing on disk holds
 * the tokens, so the render needs the provider (a setup file) and tokens are read from a probe page.
 * The setup uses the library's default theme; a team points it at its own.
 */
const RUNTIME_RECIPES: { package: string; needs?: string; adapter: Adapter; file: string; setup: string; prefix?: string; modes: Record<string, string>; staticTokens?: boolean }[] = [
  {
    // Mantine's tokens are in its stylesheet (found on disk), but its components need the provider.
    package: "@mantine/core",
    adapter: "react",
    file: "tulpar.setup.tsx",
    staticTokens: true,
    modes: {},
    setup: `// How Tulpar renders components: inside the app's MantineProvider. Pass your own theme to it.
import type { ReactNode } from "react";
import { MantineProvider } from "@mantine/core";
import "@mantine/core/styles.css";

export default function Setup({ children }: { children: ReactNode }) {
  return <MantineProvider>{children}</MantineProvider>;
}
`,
  },
  {
    package: "@fluentui/web-components",
    needs: "@fluentui/tokens",
    adapter: "web-components",
    file: "tulpar.setup.js",
    modes: {},
    setup: `// How Tulpar renders components: with the app's Fluent theme. Replace webLightTheme with yours.
import { setTheme } from "@fluentui/web-components";
import { webLightTheme } from "@fluentui/tokens";

setTheme(webLightTheme);
`,
  },
  {
    package: "@mui/material",
    adapter: "react",
    file: "tulpar.setup.tsx",
    prefix: "mui",
    modes: { dark: "dark" },
    setup: `// How Tulpar renders components: inside the app's MUI theme. Replace createTheme(...) with your
// own theme (keep cssVariables on, so Tulpar can read its tokens).
import type { ReactNode } from "react";
import { CssBaseline, ThemeProvider, createTheme } from "@mui/material";

const theme = createTheme({ cssVariables: { colorSchemeSelector: "class" }, colorSchemes: { light: true, dark: true } });

export default function Setup({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {children}
    </ThemeProvider>
  );
}
`,
  },
  {
    package: "@chakra-ui/react",
    adapter: "react",
    file: "tulpar.setup.tsx",
    prefix: "chakra",
    modes: { dark: "dark" },
    setup: `// How Tulpar renders components: inside the app's Chakra system. Replace defaultSystem with your own.
import type { ReactNode } from "react";
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";

export default function Setup({ children }: { children: ReactNode }) {
  return <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>;
}
`,
  },
  {
    package: "primeng",
    needs: "@primeuix/themes",
    adapter: "angular",
    file: "tulpar.setup.ts",
    prefix: "p",
    modes: { dark: "p-dark" },
    setup: `// How Tulpar renders components: with the app's PrimeNG theme. Replace Aura with your own preset.
import { providePrimeNG } from "primeng/config";
import Aura from "@primeuix/themes/aura";

export const providers = [providePrimeNG({ theme: { preset: Aura, options: { darkModeSelector: ".p-dark" } } })];
`,
  },
];

// Dependencies that are never the design system.
const NOT_A_DESIGN_SYSTEM = /^(react|react-dom|react-is|scheduler|@angular\/.*|rxjs|zone\.js|tslib|typescript|vite|vitest|webpack|esbuild|rollup|parcel|eslint.*|prettier|jest|@types\/.*|@testing-library\/.*|@vitest\/.*|playwright|@playwright\/.*|lit|lit-html|lit-element|@lit\/.*|next|@next\/.*|vue|svelte|@babel\/.*|postcss.*|autoprefixer|sass|less|tailwindcss|core-js|regenerator-runtime|lodash.*|clsx|classnames)$/;
const DS_WORDS = /design[- ]?system|component[s]?|ui[- ]?kit|\bui\b|widgets/i;

export function detect(root: string, options: InitOptions = {}): Detected {
  const pkgPath = join(root, "package.json");
  if (!existsSync(pkgPath)) throw new Error(`No package.json in ${root}. Run tulpar init in the front-end project's folder.`);
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  const deps: string[] = Object.keys({ ...pkg.peerDependencies, ...pkg.devDependencies, ...pkg.dependencies });
  const why: string[] = [];

  const adapter: Adapter = (options.adapter as Adapter) ?? (deps.includes("@angular/core") ? "angular" : deps.includes("react") ? "react" : "web-components");
  why.push(options.adapter ? `adapter: ${adapter} (given)` : `adapter: ${adapter} (${adapter === "angular" ? "@angular/core" : adapter === "react" ? "react" : "neither react nor @angular/core"} in package.json)`);

  // The design-system package: given, or the dependency that looks most like one.
  const dirOf = (name: string) => join(root, "node_modules", name);
  let packages: string[];
  if (options.package) {
    packages = options.package.split(",").map((p) => p.trim());
    for (const p of packages) if (!existsSync(dirOf(p))) throw new Error(`${p} is not installed (no node_modules/${p}). Run npm install first.`);
    why.push(`design system: ${packages.join(", ")} (given)`);
  } else {
    const scored = deps
      .filter((d) => !NOT_A_DESIGN_SYSTEM.test(d) && existsSync(join(dirOf(d), "package.json")))
      .map((d) => ({ name: d, ...scorePackage(dirOf(d), adapter) }))
      .filter((c) => c.score > 0)
      .sort((a, b) => b.score - a.score);
    if (!scored.length) throw new Error("Could not tell which dependency is the design system. Name it: tulpar init --package <name>.");
    packages = [scored[0]!.name];
    why.push(`design system: ${packages[0]} (${scored[0]!.evidence.join(", ")})${scored.length > 1 ? `; also considered ${scored.slice(1, 4).map((c) => c.name).join(", ")}` : ""}`);
  }
  const packageDirs = packages.map((p) => `node_modules/${p}`);

  // Tokens: DTCG files and stylesheets that declare many custom properties on theme selectors.
  const searchDirs = [...packageDirs, ...siblingTokenPackages(root, packages)];
  const files = searchDirs.flatMap((d) => walk(join(root, d), 6));
  const dtcg = files.filter((f) => /\.tokens?\.json$/i.test(f) || (f.endsWith(".json") && /[/\\](tokens|dtcg)[/\\]/i.test(f) && looksLikeDtcg(f)));
  // Source copies (src/) are partial and out of context when the package ships built sheets.
  const isSrc = (f: string) => /[/\\]src[/\\]/.test(f);
  const builtCss = files.some((f) => f.endsWith(".css") && !isSrc(f));
  const cssTokenFiles = files
    .filter((f) => f.endsWith(".css") && !f.includes(".min.") && !(builtCss && isSrc(f)) && statSync(f).size < 3_000_000)
    .map((f) => ({ f, ...cssTokenStats(f) }))
    .filter((x) => x.count >= 20)
    // Packages often ship the same sheet twice (dist/ and cdn/): keep one per file name, preferring dist.
    .sort((a, b) => Number(/[/\\]cdn[/\\]/.test(a.f)) - Number(/[/\\]cdn[/\\]/.test(b.f)) || b.count - a.count)
    .filter((x, i, all) => all.findIndex((y) => basename(y.f) === basename(x.f)) === i)
    // A sheet that repeats declarations already found (styles.css includes tokens.css) adds nothing.
    // Declarations are compared per theme: a dark theme sheet repeats the light one's names on purpose.
    .sort((a, b) => b.keys.length - a.keys.length)
    .reduce<(CssStats & { f: string })[]>((kept, x) => {
      const covered = new Set(kept.flatMap((k) => k.keys));
      const fresh = x.keys.filter((k) => !covered.has(k)).length;
      return fresh >= 0.2 * x.keys.length ? [...kept, x] : kept;
    }, [])
    .slice(0, 4);
  const tokens: Record<string, unknown> = {};
  if (dtcg.length) {
    tokens.files = dtcg.slice(0, 20).map((f) => rel(root, f));
    why.push(`tokens: ${dtcg.length} DTCG file(s)`);
  }
  let themes: Record<string, string> = {};
  let baseFont: string | undefined;
  let rootClass: string | undefined;
  if (cssTokenFiles.length) {
    const prefix = commonPrefix(cssTokenFiles.flatMap((x) => x.names));
    const modes: Record<string, string> = {};
    // The theme declared together with :root is the default, so it goes first (the render uses the first).
    const selectors = cssTokenFiles.flatMap((x) => x.themeSelectors).sort((a, b) => Number(cssTokenFiles.some((x) => x.rootThemes.includes(b))) - Number(cssTokenFiles.some((x) => x.rootThemes.includes(a))));
    for (const sel of selectors) modes[modeName(sel)] ??= sel;
    tokens.css = { files: cssTokenFiles.map((x) => rel(root, x.f)), ...(prefix && { prefix }), ...(Object.keys(modes).length && { modes }) };
    // The page font an app sets on its body: the design system's base font token.
    const fontToken = baseFontToken(cssTokenFiles.flatMap((x) => x.names), prefix);
    if (fontToken) {
      baseFont = `var(${fontToken})`;
      why.push(`page font: ${baseFont} (the render sets it on the page, as an app would)`);
    }
    const scope = cssTokenFiles.flatMap((x) => x.scopeClasses)[0];
    if (scope) {
      rootClass = scope.slice(1);
      why.push(`root class: ${rootClass} (declares its own tokens; the library's root component adds it, so the render does too)`);
    }
    themes = Object.fromEntries(Object.entries(modes).filter(([, s]) => /^\.[\w-]+$/.test(s)).map(([m, s]) => [m, s.slice(1)]));
    why.push(`tokens: custom properties in ${cssTokenFiles.map((x) => `${rel(root, x.f)} (${x.count})`).join(", ")}${prefix ? `, prefix --${prefix}-` : ""}${Object.keys(modes).length ? `, themes ${Object.keys(modes).join(", ")}` : ""}`);
  }
  if (!dtcg.length && !cssTokenFiles.length && !RUNTIME_RECIPES.some((rc) => packages.includes(rc.package))) why.push("tokens: none found (no DTCG files, no stylesheet declaring custom properties); colour and spacing checks will report hard-coded values only");

  // Stylesheets the render loads: the token sheets plus the package's main stylesheet.
  // The stylesheet the package declares ("style" in package.json) wins; never a source copy under src/.
  const declared = packages
    .map((p) => {
      const pkg = JSON.parse(readFileSync(join(root, "node_modules", p, "package.json"), "utf8"));
      return typeof pkg.style === "string" ? join(root, "node_modules", p, pkg.style) : undefined;
    })
    .find((f) => f && existsSync(f));
  const mainCss = declared
    ? cssTokenFiles.some((x) => resolve(x.f) === resolve(declared))
      ? undefined
      : declared
    : files
        .filter((f) => /[/\\](styles?|index|main|bundle|[\w-]*\.min)\.css$/i.test(f) && !/[/\\]src[/\\]/.test(f) && !cssTokenFiles.some((x) => x.f === f))
        .sort((a, b) => statSync(b).size - statSync(a).size)[0];
  const stylesheets = [...cssTokenFiles.map((x) => rel(root, x.f)), ...(mainCss ? [rel(root, mainCss)] : [])];
  if (stylesheets.length) why.push(`render loads: ${stylesheets.join(", ")}`);

  if (adapter === "react" && !existsSync(join(root, "node_modules/@types/react"))) {
    why.push("! @types/react is not installed: component props cannot be read until it is (npm install -D @types/react @types/react-dom)");
  }

  // Code Connect files in the project itself (explicit Figma ↔ code links).
  const linkDirs = [...new Set(walk(root, 6).filter((f) => /\.figma\.(tsx?|jsx?)$/.test(f)).map((f) => rel(root, join(f, ".."))))];
  if (linkDirs.length) why.push(`Code Connect: ${linkDirs.length} folder(s)`);
  else why.push("Code Connect: none; the Figma → code mapping will come from the matcher and the model, reported as unconfirmed");

  // A library that builds its theme at runtime: a setup file, and tokens read from a probe page.
  const extraFiles: Record<string, string> = {};
  const recipe = RUNTIME_RECIPES.find((rc) => packages.includes(rc.package) && rc.adapter === adapter);
  let setup: string | undefined;
  if (recipe && (recipe.staticTokens || (!dtcg.length && !cssTokenFiles.length))) {
    if (recipe.needs && !existsSync(join(root, "node_modules", recipe.needs))) {
      why.push(`! ${recipe.package} builds its theme at runtime from ${recipe.needs}, which is not installed; install it, then run tulpar init again`);
    } else {
      setup = recipe.file;
      extraFiles[recipe.file] = recipe.setup;
      if (!recipe.staticTokens) {
        tokens.runtime = { ...(recipe.prefix && { prefix: recipe.prefix }), modes: recipe.modes };
        why.push(`tokens: built by ${recipe.package} at runtime (${recipe.prefix ? `--${recipe.prefix}-*` : "custom properties"}), read from a probe page; setup: ${recipe.file} (the library's default theme: point it at yours)`);
      } else why.push(`setup: ${recipe.file}, the provider ${recipe.package} needs (pass it your own theme)`);
    }
  }

  const figmaKey = options.figma ? (parseFigmaUrl(options.figma)?.fileKey ?? options.figma) : undefined;
  const section: Record<string, unknown> = {
    packages: packageDirs,
    ...(linkDirs.length && { codeConnect: linkDirs }),
    ...(adapter !== "web-components" && { styleDirs: packageDirs }),
    ...(Object.keys(tokens).length && { tokens }),
    render: { stylesheets, ...(Object.keys(themes).length && { themes }), ...(baseFont && { baseFont }), ...(rootClass && { rootClass }), ...(setup && { setup }) },
  };
  return { adapter, why, config: { adapter, ...(figmaKey && { figma: { fileKey: figmaKey } }), [adapter]: section }, files: extraFiles };
}

export async function initCommand(dir: string, options: InitOptions = {}): Promise<number> {
  const root = resolve(dir);
  const target = join(root, "tulpar.json");
  if (existsSync(target) && !options.force) {
    console.error(`${target} already exists. Use --force to replace it.`);
    return 2;
  }
  let found: Detected;
  try {
    found = detect(root, options);
  } catch (err) {
    console.error((err as Error).message);
    return 2;
  }
  for (const line of found.why) console.log(`  ${line}`);
  await writeFile(target, JSON.stringify(found.config, null, 2) + "\n");
  console.log(`\nWrote ${target}`);
  for (const [file, content] of Object.entries(found.files)) {
    if (existsSync(join(root, file))) console.log(`Kept your ${file}`);
    else {
      await writeFile(join(root, file), content);
      console.log(`Wrote ${join(root, file)}`);
    }
  }
  if (options.noCheck) return 0;

  // Prove it: what the adapter reads with this configuration.
  const project = await loadProject(root);
  const seen = await withAdapter(project, async (host) => {
    const caps = host.manifest!.capabilities;
    return {
      index: await host.call("index", project.params),
      tokens: caps.tokens ? await host.call("tokens", project.params) : undefined,
      links: caps.links ? await host.call("links", project.params) : undefined,
    };
  });
  console.log(`\nWhat Tulpar sees:`);
  console.log(`  ${seen.index.components.length} components${seen.index.components.length ? ` (e.g. ${seen.index.components.slice(0, 5).map((c) => c.name).join(", ")})` : ""}`);
  if (seen.tokens) console.log(`  ${seen.tokens.tokens.length} tokens in ${seen.tokens.modes.length || 1} mode(s)${seen.tokens.modes.length ? `: ${seen.tokens.modes.join(", ")}` : ""}`);
  if (seen.links) console.log(`  ${seen.links.links.length} explicit Figma links`);
  for (const g of [...seen.index.gaps, ...(seen.tokens?.gaps ?? []), ...(seen.links?.gaps ?? [])].slice(0, 8)) console.log(`  – ${g}`);
  console.log(`\nNext:`);
  console.log(found.config.figma ? `  tulpar library ${(found.config.figma as { fileKey: string }).fileKey}    read the Figma library` : "  add your Figma file: tulpar init --force --figma <file URL>");
  console.log(`  tulpar generate ${relative(process.cwd(), root) || "."} --frame <node id> --name <Name>`);
  return seen.index.components.length ? 0 : 1;
}

function scorePackage(dir: string, adapter: Adapter): { score: number; evidence: string[] } {
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  const evidence: string[] = [];
  let score = 0;
  if (adapter === "web-components" && (pkg.customElements || existsSync(join(dir, "custom-elements.json")))) {
    score += 5;
    evidence.push("custom elements manifest");
  }
  const words = `${pkg.name} ${(pkg.keywords ?? []).join(" ")} ${pkg.description ?? ""}`;
  if (DS_WORDS.test(words)) {
    score += 2;
    evidence.push("described as components / design system");
  }
  if ((adapter === "react" && /react/i.test(words)) || (adapter === "angular" && /angular/i.test(words))) {
    score += 1;
    evidence.push(`mentions ${adapter}`);
  }
  if (pkg.peerDependencies?.react || pkg.peerDependencies?.["@angular/core"]) {
    score += 2;
    evidence.push("framework peer dependency");
  }
  const files = walk(dir, 4);
  if (files.some((f) => f.endsWith(".css"))) {
    score += 1;
    evidence.push("ships CSS");
  }
  if (!score) return { score, evidence };
  if (files.some((f) => f.endsWith(".d.ts"))) score += 1;
  return { score, evidence };
}

/** Token packages published next to the design system, e.g. @acme/ui + @acme/tokens. */
function siblingTokenPackages(root: string, packages: string[]): string[] {
  const out: string[] = [];
  for (const p of packages) {
    const scope = p.startsWith("@") ? p.split("/")[0]! : undefined;
    if (!scope || !existsSync(join(root, "node_modules", scope))) continue;
    for (const name of readdirSync(join(root, "node_modules", scope))) {
      if (/tokens?|themes?|styles?|foundations?/i.test(name)) out.push(`node_modules/${scope}/${name}`);
    }
  }
  return out;
}

interface CssStats {
  count: number;
  names: string[];
  /** "<mode or scope>:<property>" for every declaration found: what the sheet contributes. */
  keys: string[];
  /** Selectors that redefine the default tokens: themes. */
  themeSelectors: string[];
  /** Themes declared in the same rule as :root (the default theme). */
  rootThemes: string[];
  /** Classes that declare their own set of tokens, such as a wrapper the library's root component adds (".radix-themes"). */
  scopeClasses: string[];
}

function cssTokenStats(file: string): CssStats {
  const css = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const rootProps = new Set<string>();
  const groups: { selectors: string[]; props: string[]; withRoot: boolean }[] = [];
  for (const block of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const props = [...block[2]!.matchAll(/(--[a-zA-Z0-9_-]+)\s*:/g)].map((m) => m[1]!);
    if (!props.length) continue;
    const selectors = block[1]!.split(",").map((raw) => raw.trim().replace(/\s+/g, " "));
    if (selectors.some((s) => [":root", ":host", "html"].includes(s))) for (const p of props) rootProps.add(p);
    // ":host" alone does not make a theme the default: libraries add it to every theme for shadow roots.
    const withRoot = selectors.some((s) => [":root", "html"].includes(s));
    const simple = selectors.filter((s) => /^(\.[\w-]+|\[data-[\w-]+=["']?[\w-]+["']?\])$/.test(s));
    if (simple.length && props.length >= 10) groups.push({ selectors: simple, props, withRoot });
  }
  const names = [...rootProps];
  const keys = [...rootProps].map((p) => `default:${p}`);
  const themeSelectors: string[] = [];
  const rootThemes: string[] = [];
  const scopeClasses: string[] = [];
  const seen = new Set<string>();
  for (const g of groups) {
    // A theme redefines a large share of the default tokens (dark vs light); a variant that sets a
    // handful (an accent colour, a radius) is not a theme. Without defaults, the selector's name decides.
    const overlap = g.props.filter((p) => rootProps.has(p)).length;
    const isTheme = rootProps.size ? overlap >= 0.5 * g.props.length && g.props.length >= 0.3 * rootProps.size : g.selectors.some((s) => /theme|dark|light|mode/i.test(s));
    const first = g.selectors[0]!;
    if (isTheme) {
      const name = modeName(first);
      if (seen.has(name)) continue;
      seen.add(name);
      themeSelectors.push(first);
      if (g.withRoot) rootThemes.push(first);
      names.push(...g.props);
      keys.push(...g.props.map((p) => `${name}:${p}`));
    } else if (g.props.length >= 20 && /^\.[\w-]*themes?[\w-]*$/.test(first)) {
      scopeClasses.push(first);
      names.push(...g.props);
      keys.push(...g.props.map((p) => `${first}:${p}`));
    }
  }
  return { count: new Set(names).size, names, keys: [...new Set(keys)], themeSelectors, rootThemes, scopeClasses };
}

/** The custom property naming the design system's body font, e.g. --sl-font-sans or --acme-font-family-base. */
export function baseFontToken(names: string[], prefix: string | undefined): string | undefined {
  const p = prefix ? `${prefix}-` : "(?:[a-z0-9]+-)?";
  const patterns = [
    new RegExp(`^--${p}font-(?:family-)?(?:base|body|default|text|primary)$`),
    new RegExp(`^--${p}font-(?:family-)?sans(?:-serif)?$`),
    new RegExp(`^--${p}font-family$`),
  ];
  const unique = [...new Set(names)];
  for (const re of patterns) {
    const hit = unique.find((n) => re.test(n));
    if (hit) return hit;
  }
  return undefined;
}

/** ".sl-theme-dark" → "dark"; ".light-theme" → "light"; '[data-theme="dark"]' → "dark". */
function modeName(selector: string): string {
  const attr = /=["']?([\w-]+)["']?\]$/.exec(selector);
  if (attr) return attr[1]!;
  const words = selector.replace(/^\./, "").split(/[-_]/).filter((w) => !/^(theme|themes|mode|scheme)$/i.test(w));
  return words.at(-1) ?? selector.replace(/^\./, "");
}

function commonPrefix(names: string[]): string | undefined {
  const counts = new Map<string, number>();
  for (const n of names) {
    const first = n.slice(2).split("-")[0]!;
    counts.set(first, (counts.get(first) ?? 0) + 1);
  }
  const [top, count] = [...counts].sort((a, b) => b[1] - a[1])[0] ?? [];
  return top && count! / names.length > 0.6 ? top : undefined;
}

function looksLikeDtcg(file: string): boolean {
  if (statSync(file).size > 2_000_000) return false;
  return readFileSync(file, "utf8").includes('"$value"');
}

function walk(dir: string, depth: number): string[] {
  if (!existsSync(dir) || depth < 0) return [];
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".") || e.name === "node_modules") continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, depth - 1));
    else if (e.isFile()) out.push(p);
  }
  return out;
}

function rel(root: string, file: string): string {
  return relative(root, file).split("\\").join("/");
}
