import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Generated components (with their generated tests) are output for users, not this repo's tests.
    exclude: [...configDefaults.exclude, "out/**", "**/.tulpar/**", "examples/**"],
  },
});
