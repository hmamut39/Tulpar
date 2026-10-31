// The Rust toolchain, used as a tool: cargo compiles, wasm-bindgen packages the result for the browser.
// Compiling runs no generated code, but Rust can read the environment and files while it compiles
// (env!, include_str!): cargo gets a bare environment with no secrets, and forbidden() refuses source
// that reaches outside the component before it is compiled.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

const windows = process.platform === "win32";
const ext = windows ? ".exe" : "";

/** Where cargo lives: CARGO_HOME from TULPAR_RUST_ROOT (with cargo/ and rustup/ inside), or the usual places. */
function homes(): { cargoHome: string; rustupHome: string } | undefined {
  const roots = [process.env.TULPAR_RUST_ROOT, join(homedir(), "rust")].filter(Boolean) as string[];
  for (const r of roots) if (existsSync(join(r, "cargo", "bin", `cargo${ext}`))) return { cargoHome: join(r, "cargo"), rustupHome: join(r, "rustup") };
  const dot = join(homedir(), ".cargo");
  if (existsSync(join(dot, "bin", `cargo${ext}`))) return { cargoHome: dot, rustupHome: join(homedir(), ".rustup") };
  return undefined;
}

export const cargoFound = () => !!homes();
export const registrySrc = () => (homes() ? join(homes()!.cargoHome, "registry", "src") : undefined);

export interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Runs a tool from cargo's bin folder, with only the environment a compile needs. */
export function tool(name: "cargo" | "wasm-bindgen", args: string[], cwd: string, timeoutMs = 600_000): Promise<Run> {
  const h = homes();
  if (!h) return Promise.resolve({ code: null, stdout: "", stderr: "The Rust toolchain was not found (set TULPAR_RUST_ROOT)." });
  const bin = join(h.cargoHome, "bin");
  // On Windows the GNU toolchain's assembler and dlltool come from a MinGW kept beside it.
  const mingw = join(h.cargoHome, "..", "mingw64", "bin");
  const path = [bin, ...(windows && existsSync(mingw) ? [mingw] : []), ...(process.env.PATH ?? "").split(delimiter)].join(delimiter);
  const env: NodeJS.ProcessEnv = { PATH: path, CARGO_HOME: h.cargoHome, RUSTUP_HOME: h.rustupHome, CARGO_TERM_COLOR: "never", ...(process.env.HOME && { HOME: process.env.HOME }), ...(windows && { SYSTEMROOT: process.env.SYSTEMROOT, TEMP: process.env.TEMP, TMP: process.env.TMP, USERPROFILE: process.env.USERPROFILE, PATHEXT: process.env.PATHEXT }) };
  return new Promise((done) => {
    const child = spawn(join(bin, `${name}${ext}`), args, { cwd, env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr = (stderr + d).slice(-40_000)));
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      done({ code, stdout, stderr });
    });
  });
}

/**
 * What a generated component may not contain: compile-time reads of the server's files and environment,
 * and the ways to reach beyond the browser. A component has no need of any of them.
 */
const FORBIDDEN: [RegExp, string][] = [
  [/\b(include|include_str|include_bytes|env|option_env)\s*!/, "reading files or the environment while compiling"],
  [/#\s*\[\s*path\b/, "loading a module from another path"],
  [/#\s*!?\s*\[\s*(link|no_mangle|export_name)\b/, "linking outside the component"],
  [/\bextern\s+(crate|"C")/, "external code"],
  [/\bunsafe\b/, "unsafe code"],
  [/\bstd\s*::\s*(fs|net|process)\b/, "the file system, network or processes"],
  [/^\s*(pub\s+)?mod\s+\w+\s*;/m, "loading another file as a module"],
  [/\bmacro_rules\s*!/, "defining macros"],
];

export function forbidden(source: string): string | undefined {
  const code = source.replace(/\/\/[^\n]*/g, "");
  return FORBIDDEN.find(([re]) => re.test(code))?.[1];
}
