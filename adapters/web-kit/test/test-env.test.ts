// Generated tests run with NODE_ENV=test and without the server's secrets.

import { describe, expect, it } from "vitest";
import { testEnv } from "../src/index.ts";

describe("the test runner's environment", () => {
  it("is a test environment even on a production server, and carries no secrets", () => {
    const env = testEnv({ NODE_ENV: "production", PATH: "/bin", PLAYWRIGHT_BROWSERS_PATH: "/ms-playwright", OPENAI_API_KEY: "k", FIGMA_TOKEN: "t", STRIPE_WEBHOOK_SECRET: "s", TULPAR_ACCESS_CODES: "c", PRIMEUI_LICENSE: "l", VSCE_PAT: "p" });
    expect(env).toEqual({ NODE_ENV: "test", PATH: "/bin", PLAYWRIGHT_BROWSERS_PATH: "/ms-playwright" });
  });
});
