// The JDK and Gradle, used as tools. Compiling Kotlin runs no generated code: it runs only in the sandboxed
// browser, as WebAssembly. Gradle gets a bare environment and only ever this project's own build file.

import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

const windows = process.platform === "win32";

function inTools(prefix: string, marker: string): string | undefined {
  const tools = join(homedir(), "kotlin-tools");
  if (!existsSync(tools)) return undefined;
  const found = readdirSync(tools).find((d) => d.startsWith(prefix) && existsSync(join(tools, d, marker)));
  return found && join(tools, found);
}

export function javaHome(): string | undefined {
  const marker = join("bin", windows ? "java.exe" : "java");
  for (const d of [process.env.TULPAR_JAVA_HOME, process.env.JAVA_HOME]) if (d && existsSync(join(d, marker))) return d;
  return inTools("jdk-", marker);
}

export function gradleBin(): string | undefined {
  const marker = join("bin", windows ? "gradle.bat" : "gradle");
  if (process.env.TULPAR_GRADLE_HOME && existsSync(join(process.env.TULPAR_GRADLE_HOME, marker))) return join(process.env.TULPAR_GRADLE_HOME, marker);
  const dir = inTools("gradle-", marker);
  return dir && join(dir, marker);
}

export const toolchainFound = (): boolean => !!javaHome() && !!gradleBin();

export interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
}

export function gradle(args: string[], cwd: string, timeoutMs = 600_000): Promise<Run> {
  const bin = gradleBin();
  const java = javaHome();
  if (!bin || !java) return Promise.resolve({ code: null, stdout: "", stderr: "The JDK or Gradle was not found (set TULPAR_JAVA_HOME and TULPAR_GRADLE_HOME)." });
  const env: NodeJS.ProcessEnv = {
    PATH: [join(java, "bin"), ...(process.env.PATH ?? "").split(delimiter)].join(delimiter),
    JAVA_HOME: java,
    HOME: process.env.HOME ?? homedir(),
    ...(process.env.GRADLE_USER_HOME && { GRADLE_USER_HOME: process.env.GRADLE_USER_HOME }),
    ...(windows && { SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP, USERPROFILE: process.env.USERPROFILE, LOCALAPPDATA: process.env.LOCALAPPDATA, APPDATA: process.env.APPDATA, ComSpec: process.env.ComSpec, PATHEXT: process.env.PATHEXT }),
  };
  return new Promise((done) => {
    const child = windows ? spawn(`"${bin}" ${args.join(" ")}`, { cwd, env, shell: true }) : spawn(bin, args, { cwd, env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout = (stdout + d).slice(-60_000)));
    child.stderr.on("data", (d) => (stderr = (stderr + d).slice(-60_000)));
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      done({ code: null, stdout, stderr: err.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      done({ code, stdout, stderr });
    });
  });
}
