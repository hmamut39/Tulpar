// The weekly drift check: what it records, when it calls something drift, and that it runs once a week.

import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { Llm } from "@tulpar/core";
import { Accounts } from "../src/accounts.ts";
import { CANARY } from "../src/canary.ts";
import { startServer } from "../src/server.ts";

const repo = resolve(import.meta.dirname, "../..");
const run = (a: Accounts, at: string, status: Record<string, string>) => {
  for (const [project, s] of Object.entries(status)) a.recordCanary({ at, project, status: s, firstPass: s === "verified", attempts: s === "verified" ? 1 : 3, failing: s === "failed" ? ["layout"] : [], tokens: 100 });
};

describe("weekly drift check", () => {
  it("calls a project that passed last week and fails now drift, and nothing else", () => {
    const a = new Accounts(":memory:", { trial: 1, pro: 5 });
    expect(a.canary()).toEqual({ history: [], drift: [] });
    run(a, "2026-11-14T00:00:00.000Z", { "carbon-react": "verified", "element-plus": "failed", "carbon-svelte": "verified" });
    run(a, "2026-11-21T00:00:00.000Z", { "carbon-react": "failed", "element-plus": "failed", "carbon-svelte": "unchecked-remain" });
    const c = a.canary();
    expect(c.drift).toEqual(["carbon-react"]);
    expect(c.history[0]).toMatchObject({ at: "2026-11-21T00:00:00.000Z", project: "carbon-react", status: "failed", failing: ["layout"] });
    expect(c.history).toHaveLength(6);
    expect(a.lastCanary()).toBe("2026-11-21T00:00:00.000Z");
    expect(a.stats().canary.drift).toEqual(["carbon-react"]);
  });

  it("runs each project once through the queue, records it apart from users' runs, and not again within the week", { timeout: 180_000 }, async () => {
    const accounts = new Accounts(":memory:", { trial: 1, pro: 5 });
    // A model that fails at once: the wiring is under test here, not generation, and nothing is spent.
    const failing = { name: "failing", complete: async () => Promise.reject(new Error("no model in tests")) } as unknown as Llm;
    const auth = { clientId: "id", clientSecret: "secret", sessionSecret: "s3cret", origin: "http://localhost", secureCookies: false };
    const server = await startServer({ repoRoot: repo, llm: () => failing, auth, accounts, rerank: false, log: () => {}, canaryDays: 7, canaryPollMs: 200 }, 0);
    try {
      for (let i = 0; i < 160 && accounts.canary().history.length < CANARY.length; i++) await new Promise((r) => setTimeout(r, 1000));
      const c = accounts.canary();
      expect(c.history.map((h) => h.project).sort()).toEqual(CANARY.map((x) => x.project).sort());
      expect(new Set(c.history.map((h) => h.at)).size).toBe(1);
      // Its runs are not users' generations.
      expect(accounts.stats().generations.total).toBe(0);
      // Due again only after seven days: a few more looks run nothing.
      await new Promise((r) => setTimeout(r, 1500));
      expect(accounts.canary().history).toHaveLength(CANARY.length);
    } finally {
      await server.close();
    }
  });
});
