// A generated component's tests, run in the sandboxed browser. They are written as Leptos teams write them, with
// wasm_bindgen_test; Tulpar compiles them into the component's own WebAssembly page and opens the page once per
// test (?tulpar_test=<name>). A test that finishes passes; one that panics fails with the panic's message.

import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { TestRunResult } from "@tulpar/core";
import { serving } from "@tulpar/web-kit";
import { chromium } from "playwright";

export interface RustTest {
  name: string;
  async: boolean;
}

const RUNNER = "wasm-bindgen-test in Chromium";

/** card_test.rs → card_test: the files that hold tests, by the conventions' name. */
export const isTestFile = (f: string): boolean => /_test\.rs$/.test(f);

/** The test functions a file declares: each #[wasm_bindgen_test] fn, and whether it is async. */
export function testsIn(source: string): RustTest[] {
  return [...source.matchAll(/#\[wasm_bindgen_test\]\s*(?:pub\s+)?(async\s+)?fn\s+(\w+)\s*\(/g)].map((m) => ({ name: m[2]!, async: !!m[1] }));
}

/**
 * The test file as a module of the page: the test framework's own lines go (the page runs the tests itself), and each
 * test becomes a public function the page can call.
 */
export function asModule(source: string): string {
  return source
    .replace(/^\s*use\s+wasm_bindgen_test::[^;]*;\s*$/gm, "")
    .replace(/^\s*wasm_bindgen_test_configure!\s*\([^)]*\)\s*;\s*$/gm, "")
    .replace(/#\[wasm_bindgen_test\]\s*(?:pub\s+)?(async\s+)?fn\s+/g, (_m, a: string | undefined) => `pub ${a ?? ""}fn `);
}

/** main.rs in test mode: run the test the address names, then say so in the page's title. */
export function testDispatch(modules: { module: string; tests: RustTest[] }[]): string {
  const arms = modules.flatMap(({ module, tests }) =>
    tests.map((t) =>
      t.async
        ? `            "${t.name}" => leptos::task::spawn_local(async { generated::${module}::${t.name}().await; passed(); }),`
        : `            "${t.name}" => { generated::${module}::${t.name}(); passed(); }`,
    ),
  );
  return `    // A test, when the address names one (?tulpar_test=name): its panic, if any, is what the title says.
    let url = document().url().unwrap_or_default();
    if let Some(test) = url.split("tulpar_test=").nth(1).map(|s| s.split('&').next().unwrap_or("").to_string()) {
        std::panic::set_hook(Box::new(|info| document().set_title(&format!("TULPAR TEST FAILED: {}", info))));
        let _ = leptos::task::Executor::init_wasm_bindgen();
        fn passed() {
            document().set_title("TULPAR TEST PASSED");
        }
        match test.as_str() {
${arms.join("\n")}
            other => document().set_title(&format!("TULPAR TEST FAILED: no test named {}", other)),
        }
        return;
    }
`;
}

/** Opens the built page once per test, in a fresh context, with every other host blocked. */
export async function runTests(site: string, tests: RustTest[]): Promise<TestRunResult> {
  if (!tests.length) return { status: "ran", runner: RUNNER, tests: [], fileError: "the test file declares no #[wasm_bindgen_test] functions" };
  const browser = await chromium.launch({ args: ["--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1"] });
  try {
    return await serving(site, async (url) => {
      const here = new URL(url).host;
      const results: { name: string; status: "passed" | "failed"; error?: string }[] = [];
      for (const t of tests) {
        const context = await browser.newContext();
        await context.route("**/*", (route) => (new URL(route.request().url()).host === here ? route.continue() : route.abort()));
        const page = await context.newPage();
        let crash: string | undefined;
        page.on("pageerror", (e) => (crash ??= e.message.split("\n")[0]));
        try {
          await page.goto(`${url}?tulpar_test=${encodeURIComponent(t.name)}`);
          const title = await page
            .waitForFunction(() => document.title.startsWith("TULPAR TEST"), null, { timeout: 20_000 })
            .then(() => page.title())
            .catch(() => undefined);
          if (title === "TULPAR TEST PASSED") results.push({ name: t.name, status: "passed" });
          else results.push({ name: t.name, status: "failed", error: title?.replace(/^TULPAR TEST FAILED:\s*/, "").slice(0, 400) ?? crash ?? "the test did not finish within 20 seconds" });
        } finally {
          await context.close();
        }
      }
      return { status: "ran", runner: RUNNER, tests: results };
    });
  } finally {
    await browser.close();
  }
}

/** The tests of a built component: card_test.rs belongs to card.rs, built to .tulpar/leptos/out/card. */
export async function testBuilt(root: string, entry: string): Promise<TestRunResult> {
  const file = join(root, entry);
  if (!existsSync(file)) return { status: "failed", reason: `${entry} was not written` };
  const site = join(root, ".tulpar", "leptos", "out", basename(entry, ".rs").replace(/_test$/, ""));
  if (!existsSync(join(site, "index.html"))) return { status: "failed", reason: "the tests did not run: the component did not build" };
  return runTests(site, testsIn(readFileSync(file, "utf8")));
}
