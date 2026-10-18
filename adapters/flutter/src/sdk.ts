// The Flutter SDK, found and run as a tool: `flutter` to build, `dart` for Tulpar's analyzer programs.
// Generated Dart is compiled here, never run; it runs only in the sandboxed browser.

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";

const windows = process.platform === "win32";

/** The SDK's bin directory: TULPAR_FLUTTER_SDK or FLUTTER_ROOT, else wherever `flutter` is on the PATH. */
export function flutterBin(): string | undefined {
  for (const root of [process.env.TULPAR_FLUTTER_SDK, process.env.FLUTTER_ROOT]) {
    if (root && existsSync(join(root, "bin", windows ? "flutter.bat" : "flutter"))) return join(root, "bin");
  }
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (dir && existsSync(join(dir, windows ? "flutter.bat" : "flutter"))) return dir;
  }
  return undefined;
}

export interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Runs `flutter` or `dart` from the SDK. On Windows they are .bat files, which need a shell: arguments are quoted. */
export function sdk(tool: "flutter" | "dart", args: string[], cwd: string, timeoutMs = 600_000, env: Record<string, string> = {}): Promise<Run> {
  const bin = flutterBin();
  if (!bin) return Promise.resolve({ code: null, stdout: "", stderr: "The Flutter SDK was not found (set TULPAR_FLUTTER_SDK, or put flutter on the PATH)." });
  const command = join(bin, windows ? `${tool}.bat` : tool);
  return new Promise((resolve) => {
    const child = windows
      ? spawn(`"${command}" ${args.map(quote).join(" ")}`, { cwd, shell: true, env: { ...process.env, CI: "true", ...env } })
      : spawn(command, args, { cwd, env: { ...process.env, CI: "true", ...env } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr = (stderr + d).slice(-20_000)));
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

function quote(arg: string): string {
  if (/[^\w@%+=:,./\\-]/.test(arg)) return `"${arg.replace(/"/g, '\\"')}"`;
  return arg;
}

/** The SDK's version line ("Flutter 3.47.7"), or undefined when it is missing. */
export function flutterVersion(): string | undefined {
  const bin = flutterBin();
  if (!bin) return undefined;
  try {
    const version = readFileSync(join(bin, "..", "version"), "utf8").trim();
    if (version) return `Flutter ${version}`;
  } catch {
    // older SDKs keep it elsewhere
  }
  const out = spawnSync(join(bin, windows ? "flutter.bat" : "flutter"), ["--version"], { shell: windows, encoding: "utf8" });
  return out.stdout?.split("\n")[0]?.trim() || undefined;
}

const TOOL = join(import.meta.dirname, "..", "tool");

/**
 * Runs one of Tulpar's analyzer programs (tool/bin/<name>.dart) and parses its JSON. Results are
 * cached under the project's .tulpar/cache, keyed by `key` (what the answer depends on).
 */
export async function dartTool<T>(name: string, args: string[], root: string, key?: string): Promise<T> {
  const cacheFile = key && join(root, ".tulpar", "cache", `flutter-${name}-${createHash("sha256").update(key).digest("hex").slice(0, 16)}.json`);
  if (cacheFile && existsSync(cacheFile)) return JSON.parse(readFileSync(cacheFile, "utf8")) as T;
  if (!existsSync(join(TOOL, ".dart_tool", "package_config.json"))) {
    const got = await sdk("dart", ["pub", "get"], TOOL);
    if (got.code !== 0) throw new Error(`dart pub get failed for Tulpar's Flutter tool: ${got.stderr.slice(-400)}`);
  }
  const run = await sdk("dart", ["run", `bin/${name}.dart`, ...args], TOOL);
  if (run.code !== 0) throw new Error(`${name}: ${run.stderr.trim().split("\n").slice(-3).join(" ") || `exit ${run.code}`}`);
  const json = JSON.parse(run.stdout) as T;
  if (cacheFile) {
    mkdirSync(join(root, ".tulpar", "cache"), { recursive: true });
    writeFileSync(cacheFile, JSON.stringify(json));
  }
  return json;
}

/** A hash of the files an answer depends on (missing files count as empty). */
export function fingerprint(root: string, ...files: string[]): string {
  const h = createHash("sha256");
  for (const f of files) h.update(f).update(existsSync(join(root, f)) ? readFileSync(join(root, f)) : "");
  return h.digest("hex");
}
