// The .NET SDK, used as a tool: restores, compiles and publishes. Compiling does not run generated code;
// that happens only in the sandboxed browser, as WebAssembly.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const windows = process.platform === "win32";
const exe = windows ? "dotnet.exe" : "dotnet";

export function dotnetBin(): string | undefined {
  const dirs = [process.env.TULPAR_DOTNET_ROOT, process.env.DOTNET_ROOT, ...(process.env.PATH ?? "").split(windows ? ";" : ":"), join(homedir(), "dotnet"), join(homedir(), ".dotnet"), "/usr/share/dotnet", "/usr/lib/dotnet"];
  for (const d of dirs) if (d && existsSync(join(d, exe))) return join(d, exe);
  return undefined;
}

export interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
}

export function dotnet(args: string[], cwd: string, timeoutMs = 600_000): Promise<Run> {
  const bin = dotnetBin();
  if (!bin) return Promise.resolve({ code: null, stdout: "", stderr: "The .NET SDK was not found (set TULPAR_DOTNET_ROOT, or put dotnet on the PATH)." });
  return new Promise((done) => {
    const child = spawn(bin, args, { cwd, env: { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: "1", DOTNET_NOLOGO: "1", DOTNET_CLI_UI_LANGUAGE: "en", MSBUILDDISABLENODEREUSE: "1" } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr = (stderr + d).slice(-20_000)));
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      done({ code, stdout, stderr });
    });
  });
}

const TOOL = resolve(import.meta.dirname, "../tool/IndexComponents.csproj");

/** Runs the indexing tool, its answer cached against the project's resolved packages. */
export async function indexTool<T>(root: string, assets: string, packages: string[]): Promise<T> {
  const key = createHash("sha256").update(readFileSync(assets)).update(packages.join()).update(readFileSync(resolve(dirname(TOOL), "Program.cs"))).digest("hex").slice(0, 16);
  const cache = join(root, ".tulpar", "cache", `index-${key}.json`);
  if (existsSync(cache)) return JSON.parse(readFileSync(cache, "utf8")) as T;
  const run = await dotnet(["run", "--project", TOOL, "-c", "Release", "--", assets, ...packages], root);
  if (run.code !== 0) throw new Error(`Reading the components failed: ${(run.stderr || run.stdout).slice(-800)}`);
  const json = run.stdout.slice(run.stdout.indexOf('{"components"'));
  JSON.parse(json);
  mkdirSync(dirname(cache), { recursive: true });
  writeFileSync(cache, json);
  return JSON.parse(json) as T;
}
