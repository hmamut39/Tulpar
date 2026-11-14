// Generated tests run with NODE_ENV=test and without the server's secrets.

import { describe, expect, it } from "vitest";
import { testEnv } from "../src/index.ts";

describe("the test runner's environment", () => {
  it("is a test environment even on a production server, and carries no secrets", () => {
    const env = testEnv({ NODE_ENV: "production", PATH: "/bin", PLAYWRIGHT_BROWSERS_PATH: "/ms-playwright", OPENAI_API_KEY: "k", FIGMA_TOKEN: "t", STRIPE_WEBHOOK_SECRET: "s", TULPAR_ACCESS_CODES: "c", PRIMEUI_LICENSE: "l", VSCE_PAT: "p" });
    expect(env).toEqual({ NODE_ENV: "test", PATH: "/bin", PLAYWRIGHT_BROWSERS_PATH: "/ms-playwright" });
  });
});

describe("a run broken by Vite re-optimizing its dependencies", () => {
  it("is run again; a real import failure is not", async () => {
    const { staleOptimizedDeps } = await import("../src/tests.ts");
    const vite = 'Failed to import test file /w/examples/carbon-svelte/.tulpar/matrix/ts/Matrix.test.ts: [vite] (client) Pre-transform error: The file does not exist at "/w/examples/carbon-svelte/node_modules/.vite/vitest/da39a3ee5e/deps/carbon.js"';
    const own = 'Failed to import test file: The file does not exist at "/w/examples/x/.tulpar/vitest/17-ab12cd-cache/vitest/da39/deps/x.js"';
    expect(staleOptimizedDeps({ status: "ran", runner: "Vitest in Chromium", tests: [], fileError: vite })).toBe(true);
    expect(staleOptimizedDeps({ status: "ran", runner: "Vitest in Chromium", tests: [], fileError: own })).toBe(true);
    expect(staleOptimizedDeps({ status: "ran", runner: "Vitest in Chromium", tests: [], fileError: 'Failed to resolve import "./Missing.svelte"' })).toBe(false);
    expect(staleOptimizedDeps({ status: "ran", runner: "Vitest in Chromium", tests: [{ name: "a", status: "passed" }] })).toBe(false);
  });
});

describe("why a test file did not import", () => {
  it("names a parse error and where it is", async () => {
    const { importError } = await import("../src/tests.ts");
    const out = ["(!) Failed to run dependency scan. Skipping dependency pre-bundling.", "[PARSE_ERROR] Expected `}` but found `EOF`", "    ╭─[ .tulpar/x/Card.test.ts:93:7 ]", " 39 │ describe(\"Card\", () => {"].join("\n");
    expect(importError(out)).toBe("[PARSE_ERROR] Expected `}` but found `EOF` at .tulpar/x/Card.test.ts:93:7");
  });

  it("names a module that does not resolve, and esbuild's capitalised errors", async () => {
    const { importError } = await import("../src/tests.ts");
    expect(importError('[vite] Internal server error: Failed to resolve import "@testing-library/user-event" from "Card.test.tsx".')).toMatch(/Failed to resolve import "@testing-library\/user-event"/);
    expect(importError("Transform failed with 1 error:\nCard.test.ts:94:0: ERROR: Unexpected end of file")).toMatch(/ERROR: Unexpected end of file/);
  });
});
