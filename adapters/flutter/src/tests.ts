// Generated widget tests, run with `flutter test --platform chrome`: the test code runs inside
// headless Chromium (Playwright's, never a person's own browser), not on the host.
//
// Flutter's web test runner only reaches files under the project's test/ folder, so the widget and
// its test are copied to test/tulpar_run/ for the run and removed afterwards.

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { chromium } from "playwright";
import type { TestRunResult } from "@tulpar/core";
import { sdk } from "./sdk.ts";

interface Event {
  type: string;
  test?: { id: number; name: string; url: string | null };
  testID?: number;
  result?: "success" | "failure" | "error";
  hidden?: boolean;
  skipped?: boolean;
  error?: string;
}

export async function runWidgetTests(root: string, testFile: string, timeoutMs = 300_000): Promise<TestRunResult> {
  const from = dirname(join(root, testFile));
  const run = join(root, "test", "tulpar_run");
  rmSync(run, { recursive: true, force: true });
  mkdirSync(run, { recursive: true });
  for (const f of readdirSync(from)) if (f.endsWith(".dart")) cpSync(join(from, f), join(run, f));
  try {
    const browser = chromium.executablePath();
    if (!existsSync(browser)) return { status: "unsupported", reason: "Playwright's Chromium is not installed (npx playwright install chromium)" };
    const result = await sdk("flutter", ["test", "--platform", "chrome", "--reporter", "json", `test/tulpar_run/${basename(testFile)}`], root, timeoutMs, { CHROME_EXECUTABLE: browser });
    return parse(result.stdout, result.code);
  } finally {
    rmSync(run, { recursive: true, force: true });
  }
}

export function parse(stdout: string, code: number | null): TestRunResult {
  const events = stdout.split("\n").filter((l) => l.startsWith("{")).map((l) => JSON.parse(l) as Event);
  const names = new Map<number, { name: string; loading: boolean }>();
  const errors = new Map<number, string>();
  const tests: { name: string; status: "passed" | "failed" | "skipped"; error?: string }[] = [];
  let fileError: string | undefined;
  for (const e of events) {
    if (e.type === "testStart" && e.test) names.set(e.test.id, { name: e.test.name, loading: e.test.url === null && e.test.name.startsWith("loading ") });
    if (e.type === "error" && e.testID !== undefined && e.error) errors.set(e.testID, errors.get(e.testID) ?? e.error.split("\n").filter((l) => l.trim()).slice(0, 4).join(" "));
    if (e.type === "testDone" && e.testID !== undefined) {
      const t = names.get(e.testID);
      if (!t) continue;
      // The suite failing to load (it did not compile) is the file's error, not a test.
      if (t.loading) {
        if (e.result !== "success") fileError = errors.get(e.testID) ?? "the test file did not load";
        continue;
      }
      if (e.hidden) continue;
      tests.push({ name: t.name, status: e.skipped ? "skipped" : e.result === "success" ? "passed" : "failed", ...(e.result !== "success" && errors.has(e.testID) && { error: errors.get(e.testID)! }) });
    }
  }
  if (!events.length) return { status: "failed", reason: `flutter test reported nothing (exit ${code})` };
  return { status: "ran", runner: "flutter test in Chromium", tests, ...(fileError && { fileError }) };
}
