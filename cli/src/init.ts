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
}

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
  const cssTokenFiles = files
    .filter((f) => f.endsWith(".css") && !f.includes(".min.") && statSync(f).size < 3_000_000)
    .map((f) => ({ f, ...cssTokenStats(f) }))
    .filter((x) => x.count >= 20)
    // Packages often ship the same sheet twice (dist/ and cdn/): keep one per file name, preferring dist.
    .sort((a, b) => Number(/[/\\]cdn[/\\]/.test(a.f)) - Number(/[/\\]cdn[/\\]/.test(b.f)) || b.count - a.count)
    .filter((x, i, all) => all.findIndex((y) => basename(y.f) === basename(x.f)) === i)
    .slice(0, 4);
  const tokens: Record<string, unknown> = {};
  if (dtcg.length) {
    tokens.files = dtcg.slice(0, 20).map((f) => rel(root, f));
    why.push(`tokens: ${dtcg.length} DTCG file(s)`);
  }
  let themes: Record<string, string> = {};
  if (cssTokenFiles.length) {
    const prefix = commonPrefix(cssTokenFiles.flatMap((x) => x.names));
    const modes: Record<string, string> = {};
    // The theme declared together with :root is the default, so it goes first (the render uses the first).
    const selectors = cssTokenFiles.flatMap((x) => x.themeSelectors).sort((a, b) => Number(cssTokenFiles.some((x) => x.rootThemes.includes(b))) - Number(cssTokenFiles.some((x) => x.rootThemes.includes(a))));
    for (const sel of selectors) modes[modeName(sel)] ??= sel;
    tokens.css = { files: cssTokenFiles.map((x) => rel(root, x.f)), ...(prefix && { prefix }), ...(Object.keys(modes).length && { modes }) };
    themes = Object.fromEntries(Object.entries(modes).filter(([, s]) => /^\.[\w-]+$/.test(s)).map(([m, s]) => [m, s.slice(1)]));
    why.push(`tokens: custom properties in ${cssTokenFiles.map((x) => `${rel(root, x.f)} (${x.count})`).join(", ")}${prefix ? `, prefix --${prefix}-` : ""}${Object.keys(modes).length ? `, themes ${Object.keys(modes).join(", ")}` : ""}`);
  }
  if (!dtcg.length && !cssTokenFiles.length) why.push("tokens: none found (no DTCG files, no stylesheet declaring custom properties); colour and spacing checks will report hard-coded values only");

  // Stylesheets the render loads: the token sheets plus the package's main stylesheet.
  const mainCss = files
    .filter((f) => /[/\\](styles?|index|main|bundle|[\w-]*\.min)\.css$/i.test(f) && !cssTokenFiles.some((x) => x.f === f))
    .sort((a, b) => statSync(b).size - statSync(a).size)[0];
  const stylesheets = [...cssTokenFiles.map((x) => rel(root, x.f)), ...(mainCss ? [rel(root, mainCss)] : [])];
  if (stylesheets.length) why.push(`render loads: ${stylesheets.join(", ")}`);

  // Code Connect files in the project itself (explicit Figma ↔ code links).
  const linkDirs = [...new Set(walk(root, 6).filter((f) => /\.figma\.(tsx?|jsx?)$/.test(f)).map((f) => rel(root, join(f, ".."))))];
  if (linkDirs.length) why.push(`Code Connect: ${linkDirs.length} folder(s)`);
  else why.push("Code Connect: none; the Figma → code mapping will come from the matcher and the model, reported as unconfirmed");

  const figmaKey = options.figma ? (parseFigmaUrl(options.figma)?.fileKey ?? options.figma) : undefined;
  const section: Record<string, unknown> = {
    packages: packageDirs,
    ...(linkDirs.length && { codeConnect: linkDirs }),
    ...(adapter !== "web-components" && { styleDirs: packageDirs }),
    ...(Object.keys(tokens).length && { tokens }),
    render: { stylesheets, ...(Object.keys(themes).length && { themes }) },
  };
  return { adapter, why, config: { adapter, ...(figmaKey && { figma: { fileKey: figmaKey } }), [adapter]: section } };
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

function cssTokenStats(file: string): { count: number; names: string[]; themeSelectors: string[]; rootThemes: string[] } {
  const css = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const names: string[] = [];
  const themeSelectors = new Set<string>();
  const rootThemes = new Set<string>();
  for (const block of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const props = [...block[2]!.matchAll(/(--[a-zA-Z0-9_-]+)\s*:/g)].map((m) => m[1]!);
    if (!props.length) continue;
    const selectors = block[1]!.split(",").map((raw) => raw.trim().replace(/\s+/g, " "));
    // ":host" alone does not make a theme the default: libraries add it to every theme for shadow roots.
    const withRoot = selectors.some((s) => [":root", "html"].includes(s));
    for (const s of selectors) {
      if ([":root", ":host", "html"].includes(s)) names.push(...props);
      else if (props.length >= 10 && /^(\.[\w-]*(theme|dark|light|mode)[\w-]*|\[data-[\w-]*(theme|mode)[\w-]*=["']?[\w-]+["']?\])$/i.test(s)) {
        themeSelectors.add(s);
        if (withRoot) rootThemes.add(s);
        names.push(...props);
      }
    }
  }
  return { count: new Set(names).size, names, themeSelectors: [...themeSelectors], rootThemes: [...rootThemes] };
}

/** ".sl-theme-dark" → "dark"; '[data-theme="dark"]' → "dark". */
function modeName(selector: string): string {
  const attr = /=["']?([\w-]+)["']?\]$/.exec(selector);
  if (attr) return attr[1]!;
  const words = selector.replace(/^\./, "").split(/[-_]/);
  return words.at(-1)!;
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
