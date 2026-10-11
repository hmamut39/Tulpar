// Any design system on npm, added from the web page: the visitor names a package, and Tulpar
// installs it, sets it up with `tulpar init`, checks it has components, and offers it in the list.
//
// Safety:
// - only names and versions npm itself accepts; the registry is asked first (does it exist, how big);
// - `npm install --ignore-scripts`: no package code runs on the server. Package code only ever runs
//   inside the render's sandboxed Chromium, with the network blocked;
// - the install runs without the server's secrets in its environment, with a time limit, one at a time;
// - each package@version is installed once and shared: public packages, nothing private is kept.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { detect } from "@tulpar/cli/init";
import { loadProject, withAdapter } from "@tulpar/cli/project";

export type Framework = "react" | "angular" | "web-components";

export interface AddRequest {
  package: string;
  version?: string;
  framework?: Framework;
}

export interface AddJob {
  id: string;
  state: "running" | "done" | "error";
  steps: string[];
  projectId?: string;
  error?: string;
}

const NAME = /^(@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/;
const VERSION = /^[0-9A-Za-z.+~^<>=*-]{1,40}$/;
const MAX_UNPACKED = 120 * 1024 * 1024;
const MAX_PROJECTS = Number(process.env.TULPAR_MAX_DESIGN_SYSTEMS || 25);

// What a component library needs next to it to be indexed and rendered.
const BASELINE: Record<Framework, Record<string, string>> = {
  react: { react: "^19.2.0", "react-dom": "^19.2.0", "@types/react": "^19.2.0", "@types/react-dom": "^19.2.0" },
  angular: {
    "@angular/animations": "22.2.0", "@angular/cdk": "22.2.0", "@angular/common": "22.2.0", "@angular/compiler": "22.2.0", "@angular/core": "22.2.0",
    "@angular/forms": "22.2.0", "@angular/platform-browser": "22.2.0", "@angular/router": "22.2.0", rxjs: "7.8.2", "zone.js": "0.16.3",
  },
  "web-components": {},
};

export function projectId(name: string, version: string): string {
  return `npm-${name.replace(/^@/, "").replace(/[^a-z0-9]+/gi, "-")}-${version.replace(/[^0-9A-Za-z]+/g, "-")}`.toLowerCase().slice(0, 80);
}

/** Checks the request against npm's rules and the registry. Returns the exact version and framework. */
export async function resolvePackage(req: AddRequest, fetchImpl: typeof fetch = fetch): Promise<{ name: string; version: string; framework: Framework }> {
  const name = req.package.trim().toLowerCase();
  if (!NAME.test(name) || name.length > 214) throw new Error("That is not an npm package name (e.g. @acme/ui or @shoelace-style/shoelace).");
  const wanted = (req.version ?? "").trim() || "latest";
  if (!VERSION.test(wanted)) throw new Error("That version is not valid (e.g. 2.3.1, or leave it empty for the latest).");
  const res = await fetchImpl(`https://registry.npmjs.org/${name.replace("/", "%2F")}/${encodeURIComponent(wanted)}`);
  if (res.status === 404) throw new Error(`npm has no package ${name}${wanted === "latest" ? "" : ` at ${wanted}`}.`);
  if (!res.ok) throw new Error(`npm did not answer (${res.status}). Try again in a minute.`);
  const meta = (await res.json()) as { version: string; peerDependencies?: Record<string, string>; dependencies?: Record<string, string>; dist?: { unpackedSize?: number }; customElements?: string };
  if ((meta.dist?.unpackedSize ?? 0) > MAX_UNPACKED) throw new Error(`${name} is too large to install here (${Math.round((meta.dist!.unpackedSize ?? 0) / 1048576)} MB).`);
  const deps = { ...meta.dependencies, ...meta.peerDependencies };
  const framework: Framework = req.framework ?? (deps["@angular/core"] ? "angular" : deps.react ? "react" : "web-components");
  return { name, version: meta.version, framework };
}

/** Installs and sets up a package as a project under `root`. Steps are reported as they happen. */
export async function addProject(root: string, req: AddRequest, step: (text: string) => void, fetchImpl?: typeof fetch): Promise<string> {
  const { name, version, framework } = await resolvePackage(req, fetchImpl);
  const id = projectId(name, version);
  const dir = join(root, id);
  if (existsSync(join(dir, "tulpar.json"))) {
    step(`${name}@${version} is already set up.`);
    return id;
  }
  // The data disk is shared and small: a cap on how many design systems are installed.
  if (listCustom(root).length >= MAX_PROJECTS) throw new Error("Tulpar has no room for more design systems right now. Write to us and we'll make space.");
  step(`Installing ${name}@${version} (${framework === "web-components" ? "Web Components" : framework === "react" ? "React" : "Angular"})…`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: id, private: true, description: `${name}@${version}, added from the Tulpar web page.`, dependencies: { [name]: version, ...BASELINE[framework] } }, null, 2) + "\n");
  try {
    await npmInstall(dir);
    step("Reading its components and tokens…");
    const found = detect(dir, { package: name, adapter: framework });
    writeFileSync(join(dir, "tulpar.json"), JSON.stringify(found.config, null, 2) + "\n");
    for (const [file, content] of Object.entries(found.files)) writeFileSync(join(dir, file), content);
    const project = await loadProject(dir);
    const index = await withAdapter(project, (host) => host.call("index", project.params));
    if (!index.components.length) throw new Error(`No components were found in ${name}. ${index.gaps[0] ?? ""}`.trim());
    step(`Ready: ${index.components.length} components.`);
    return id;
  } catch (err) {
    rmSync(dir, { recursive: true, force: true });
    throw err;
  }
}

/**
 * npm install with no lifecycle scripts, no secrets in the environment, and a time limit. Peers are
 * installed (Fluent needs @microsoft/fast-element); only when they conflict is the install retried
 * without them.
 */
async function npmInstall(dir: string): Promise<void> {
  try {
    await runNpm(dir, []);
  } catch (err) {
    if (!/ERESOLVE|peer dep/i.test((err as Error).message)) throw err;
    await runNpm(dir, ["--legacy-peer-deps"]);
  }
}

function runNpm(dir: string, extra: string[]): Promise<void> {
  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, HOME: process.env.HOME ?? dir, USERPROFILE: process.env.USERPROFILE, APPDATA: process.env.APPDATA, SystemRoot: process.env.SystemRoot, npm_config_cache: join(dir, "..", ".npm-cache") };
  return new Promise((resolve, reject) => {
    const npm = process.platform === "win32" ? "npm.cmd" : "npm";
    const child = spawn(npm, ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--loglevel=error", ...extra], { cwd: dir, env, shell: process.platform === "win32", stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    child.stderr.on("data", (d) => (err = (err + d).slice(-2000)));
    const timer = setTimeout(() => child.kill(), 240_000);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`npm install failed${err ? `: ${err.trim().split("\n").at(-1)}` : " (timed out)"}`));
    });
  });
}

/** The projects added so far (directories with a tulpar.json). */
export function listCustom(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(join(root, d.name, "tulpar.json"))).map((d) => d.name);
}
