// Generated widget tests, run with `flutter test --platform chrome`: the test code runs inside
// headless Chromium (Playwright's, never a person's own browser), not on the host.
//
// Flutter's web test runner only reaches files under the project's test/ folder, so the widget and
// its test are copied to test/tulpar_run/ for the run and removed afterwards.

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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
  message?: string;
}

/**
 * A widget test's failure is printed as an "EXCEPTION CAUGHT BY FLUTTER TEST FRAMEWORK" block, and its error
 * event only says "See exception logs above". The block's own lines (what was thrown, Expected, Actual, Which)
 * are what a repair needs; the stack and the decoration are left out.
 */
export function exception(printed: string): string | undefined {
  const lines = printed.split("\n");
  const start = lines.findIndex((l) => l.includes("EXCEPTION CAUGHT BY"));
  if (start < 0) return undefined;
  const body: string[] = [];
  for (const l of lines.slice(start + 1)) {
    if (/^When the exception was thrown|^The test description was|^═{3,}/.test(l.trim())) break;
    if (l.trim()) body.push(l.trim());
  }
  return body.length ? body.slice(0, 8).join(" ") : undefined;
}

/**
 * Every exception block in the run's whole output (the JSON reporter's print messages and any plain lines
 * Flutter writes beside them), by the test it names on its "The test description was:" line. On the web the
 * block need not arrive as a print event of that test, so it is matched by name.
 */
export function exceptionsByTest(stdout: string): Map<string, string> {
  const text = stdout
    .split("\n")
    .map((l) => {
      if (!l.startsWith("{")) return l;
      try {
        const e = JSON.parse(l) as Event;
        return e.type === "print" && e.message ? e.message : "";
      } catch {
        return l;
      }
    })
    .join("\n");
  const found = new Map<string, string>();
  for (const block of text.split(/(?=^.*EXCEPTION CAUGHT BY)/m).slice(1)) {
    const name = /The test description was:\s*\n?\s*(.+)/.exec(block)?.[1]?.trim();
    const what = exception(block);
    if (name && what && !found.has(name)) found.set(name, what);
  }
  return found;
}

// A run takes about a minute. Now and then Flutter's web runner starts Chromium and the suite never
// loads (it waits on the browser until killed): such a run is started again once, with a fresh browser.
const ATTEMPT_MS = 180_000;

/**
 * On the web, a failed widget test's exception (Expected, Actual, Which) stays in the browser's console: the
 * JSON report only says "See exception logs above". Flutter runs a flutter_test_config.dart beside the tests
 * first, and this one prints each exception, which the report carries as a print event of that test.
 */
const REPORT_EXCEPTIONS = `import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';

Future<void> testExecutable(FutureOr<void> Function() testMain) async {
  final original = reportTestException;
  reportTestException = (FlutterErrorDetails details, String testDescription) {
    print('EXCEPTION CAUGHT BY FLUTTER TEST FRAMEWORK\\n\${details.exceptionAsString()}\\nThe test description was:\\n  \$testDescription');
    original(details, testDescription);
  };
  await testMain();
}
`;

export async function runWidgetTests(root: string, testFile: string, timeoutMs = ATTEMPT_MS): Promise<TestRunResult> {
  if (process.platform === "win32") return { status: "unsupported", reason: "flutter test --platform chrome does not run on Windows here; it runs on Linux" };
  const from = dirname(join(root, testFile));
  const run = join(root, "test", "tulpar_run");
  rmSync(run, { recursive: true, force: true });
  mkdirSync(run, { recursive: true });
  for (const f of readdirSync(from)) if (f.endsWith(".dart")) cpSync(join(from, f), join(run, f));
  writeFileSync(join(run, "flutter_test_config.dart"), REPORT_EXCEPTIONS);
  try {
    const browser = testBrowser(chromium.executablePath());
    if (!browser) return { status: "unsupported", reason: "Playwright's Chromium is not installed (npx playwright install chromium)" };
    const once = async () => {
      const result = await sdk("flutter", ["test", "--platform", "chrome", "--reporter", "json", `test/tulpar_run/${basename(testFile)}`], root, timeoutMs, { CHROME_EXECUTABLE: browser });
      return parse(result.stdout, result.code, result.stderr);
    };
    const first = await once();
    return stalled(first) ? once() : first;
  } finally {
    rmSync(run, { recursive: true, force: true });
  }
}

/** Playwright's full Chromium, or its headless shell of the same revision: the image installs only the shell. */
export function testBrowser(full: string): string | undefined {
  if (existsSync(full)) return full;
  // <browsers>/chromium-1243/chrome-linux64/chrome -> <browsers>/chromium_headless_shell-1243/<folder>/<program>
  const installed = dirname(dirname(full));
  const shell = join(dirname(installed), basename(installed).replace("chromium-", "chromium_headless_shell-"));
  if (!existsSync(shell)) return undefined;
  for (const folder of readdirSync(shell)) {
    for (const program of ["chrome-headless-shell", "headless_shell"]) {
      if (existsSync(join(shell, folder, program))) return join(shell, folder, program);
    }
  }
  return undefined;
}

const STALLED = "the test browser did not load the tests in time (flutter test was stopped)";
/** A run whose browser never loaded the suite: worth one more try. */
export const stalled = (r: TestRunResult) => r.status === "failed" && (r.reason === STALLED || r.reason === "flutter test did not finish in time and reported nothing");

/** stderr: where Flutter's web runner writes the exception blocks of failed widget tests. */
export function parse(stdout: string, code: number | null, stderr = ""): TestRunResult {
  const events = stdout.split("\n").filter((l) => l.startsWith("{")).map((l) => JSON.parse(l) as Event);
  const names = new Map<number, { name: string; loading: boolean }>();
  const errors = new Map<number, string>();
  const printed = new Map<number, string>();
  const named = exceptionsByTest(`${stdout}\n${stderr}`);
  const tests: { name: string; status: "passed" | "failed" | "skipped"; error?: string }[] = [];
  let fileError: string | undefined;
  for (const e of events) {
    if (e.type === "testStart" && e.test) names.set(e.test.id, { name: e.test.name, loading: e.test.url === null && e.test.name.startsWith("loading ") });
    if (e.type === "print" && e.testID !== undefined && e.message) printed.set(e.testID, `${printed.get(e.testID) ?? ""}${e.message}\n`);
    if (e.type === "error" && e.testID !== undefined && e.error && !errors.has(e.testID)) {
      const own = e.error.split("\n").filter((l) => l.trim()).slice(0, 4).join(" ");
      const name = names.get(e.testID)?.name ?? "";
      const described = /The test description was:\s*(.+)/.exec(e.error)?.[1]?.trim();
      const logged = /See exception logs above/.test(e.error)
        ? (exception(printed.get(e.testID) ?? "") ?? named.get(described ?? name) ?? [...named].find(([n]) => name.endsWith(n))?.[1])
        : undefined;
      errors.set(e.testID, logged ?? own);
    }
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
  if (!events.length) return { status: "failed", reason: code === null ? "flutter test did not finish in time and reported nothing" : `flutter test reported nothing (exit ${code})` };
  // Killed with no test finished and the file never loaded: the browser never ran the suite.
  const loaded = events.some((e) => e.type === "testDone" && e.testID !== undefined && names.get(e.testID)?.loading);
  if (code === null && !tests.length && !fileError && !loaded) return { status: "failed", reason: STALLED };
  return { status: "ran", runner: "flutter test in Chromium", tests, ...(fileError && { fileError }) };
}
