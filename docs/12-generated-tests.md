# G7: generated tests actually run (2026-09-27)

Every generated component comes with a test file (`.test.tsx` for React, `.component.spec.ts` for Angular). Until now they were delivered but marked "not run". A test nobody ran proves nothing, so Tulpar now **runs them**, and the result is a check in the report: **"Generated tests"**.

## How

- **Vitest in browser mode:** the test code executes only in headless Chromium (Playwright), never in Node on the host or server. The Node side only serves and transforms files.
- **The network is locked:** Chromium resolves nothing but the local test server. A test that tries `fetch("https://example.com/")` fails (tested).
- **The project's own tools:** Vitest runs from the project's own dependencies (each example has `vitest`, `@vitest/browser-playwright` and Testing Library), with the standard globals a normal project enables.
- **Angular:** specs run with TestBed. A small Vite plugin inlines `templateUrl` and compiles Angular's decorators in JIT mode, and a setup file initialises Angular's test environment.
- **Generation:** the generated test file runs as part of every verification, so **failing tests go back to the model for repair**, like any other failed check.

The **"Generated tests"** check:

| Situation | Result |
|---|---|
| every test ran and passed | ✓ "N of N generated tests pass" |
| a test failed | ✗, each failure listed with its message |
| the file didn't compile, or declares no tests | ✗ |
| the runner couldn't start (e.g. Vitest not installed) | – not checked (an environment problem, not a test failure) |
| the adapter can't run tests (Web Components, for now) | – not checked, stated |

`tulpar verify` runs a test file with `--test <file>`; `tulpar generate` runs the generated one automatically.

## Results

- **React, real model:** the AI's 3 tests run in the browser, and all 3 pass.
  - The first spike found one failing ("expected 2 buttons, got 4"). The cause was the test environment: Testing Library cleans up between tests only with Vitest's standard globals. The runner now uses the standard setup a real project has.
- **Angular, real model:**
  - **Attempt 1:** layout was off, and **1 of the AI's own 4 tests failed**.
  - **Attempt 2:** both failures were fed back; the repair passed all checks and **4 of 4 tests**.
- **Angular reference spec:** 1 of 1 passes under TestBed.

## Also fixed

- **Test runs overwrote real results.** Tests that exercised `generate` wrote into the same `out/` folder as real runs, and one overwrote a real React result. Generation now takes a results folder, and every test uses a temporary one.

156 tests pass.
