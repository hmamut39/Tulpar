import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Generated components (with their generated tests) are output for users, not this repo's tests.
    exclude: [...configDefaults.exclude, "out/**", "**/.tulpar/**", "examples/**"],
    // Many tests start adapter processes and browsers, all in parallel: the defaults (5 s, 10 s) are too
    // tight under that load. Tests that need longer still set their own.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
