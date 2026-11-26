import { availableParallelism } from "node:os";
import { configDefaults, defineConfig } from "vitest/config";

// Many test files build and render in Chromium or start a project's toolchain. On a small machine (4 cores) the
// default of one worker per core but one runs three of those at once and their tests time out, though each passes
// alone. Outside CI, at most half the cores run test files, and tests get more time; CI keeps Vitest's defaults.
const local = !process.env.CI;
const cores = availableParallelism();

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, "out/**", "**/.tulpar/**", "examples/**", "cli/test/golden/**"],
    testTimeout: local ? 60_000 : 30_000,
    hookTimeout: local ? 120_000 : 60_000,
    ...(local && cores <= 8 && { maxWorkers: Math.max(1, Math.floor(cores / 2)) }),
  },
});
