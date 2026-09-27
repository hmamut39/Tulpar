// Run a generated test file with Vitest in browser mode: the test code executes only in
// headless Chromium (Playwright), never in Node on the host, and the browser can reach
// nothing but the local test server. Vitest is run from the project's own dependencies,
// as a child process, with its JSON report as the result.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { TestRunResult } from "@tulpar/core";

export interface VitestOptions {
  root: string;
  /** Test file, relative to the root. */
  testFile: string;
  /** Extra lines at the top of the config (imports of plugins), and the plugins expression. */
  pluginImports?: string[];
  plugins?: string;
  /** Setup files, relative to the root, run in the browser before the tests. */
  setupFiles?: string[];
  timeoutMs?: number;
}

export async function runVitestBrowser(o: VitestOptions): Promise<TestRunResult> {
  const vitest = join(o.root, "node_modules", "vitest", "vitest.mjs");
  if (!existsSync(vitest) || !existsSync(join(o.root, "node_modules", "@vitest", "browser-playwright"))) {
    return { status: "unsupported", reason: "the project has no Vitest browser mode installed (vitest, @vitest/browser-playwright)" };
  }
  const dir = join(o.root, ".tulpar", "vitest");
  await mkdir(dir, { recursive: true });
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const configFile = join(dir, `${id}.config.mjs`);
  const reportFile = join(dir, `${id}.json`);
  const config = `import { defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";
${(o.pluginImports ?? []).join("\n")}
export default defineConfig({
  root: ${JSON.stringify(o.root.replace(/\\/g, "/"))},
  ${o.plugins ? `plugins: ${o.plugins},` : ""}
  test: {
    globals: true,
    include: [${JSON.stringify(o.testFile.replace(/\\/g, "/"))}],
    ${o.setupFiles?.length ? `setupFiles: ${JSON.stringify(o.setupFiles)},` : ""}
    testTimeout: 15000,
    browser: {
      enabled: true,
      headless: true,
      // Nothing but the local test server resolves: generated tests cannot reach the network.
      provider: playwright({ launchOptions: { args: ["--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1"] } }),
      instances: [{ browser: "chromium" }],
    },
  },
});
`;
  await writeFile(configFile, config);
  try {
    const { code, output } = await run(process.execPath, [vitest, "run", "--config", configFile, "--reporter=json", `--outputFile=${reportFile}`], o.root, o.timeoutMs ?? 120_000);
    if (!existsSync(reportFile)) return { status: "failed", reason: `Vitest produced no report (exit ${code}). ${output.slice(-800)}` };
    const report = JSON.parse(await readFile(reportFile, "utf8")) as JestLikeReport;
    const file = report.testResults[0];
    const tests = (file?.assertionResults ?? []).map((a) => ({
      name: a.fullName || a.title,
      status: a.status === "passed" ? ("passed" as const) : a.status === "failed" ? ("failed" as const) : ("skipped" as const),
      ...(a.failureMessages?.length && { error: clean(a.failureMessages.join("\n")) }),
    }));
    const fileError = file?.status === "failed" && !tests.some((t) => t.status === "failed") ? clean(file.message || "the test file failed") : undefined;
    return { status: "ran", runner: "vitest (browser mode, chromium)", tests, ...(fileError && { fileError }) };
  } finally {
    await rm(configFile, { force: true });
    await rm(reportFile, { force: true });
  }
}

interface JestLikeReport {
  testResults: { status: string; message?: string; assertionResults: { title: string; fullName?: string; status: string; failureMessages?: string[] }[] }[];
}

/** First line of an assertion error, without the dev-server stack. */
function clean(message: string): string {
  return message
    .split("\n")
    .filter((l) => !/^\s+at /.test(l))
    .join(" ")
    .replace(/\s+/g, " ")
    .slice(0, 400)
    .trim();
}

function run(cmd: string, args: string[], cwd: string, timeoutMs: number): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (d) => (output = (output + d).slice(-4000)));
    child.stderr.on("data", (d) => (output = (output + d).slice(-4000)));
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, output });
    });
  });
}
