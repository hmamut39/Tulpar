// The same design asked for again: the earlier job answers, waiting, running or passed, and no generation is used.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ScriptedLlm } from "@tulpar/core";
import { Accounts } from "../src/accounts.ts";
import { startServer } from "../src/server.ts";
import { orderCard } from "../../cli/src/order-card.ts";

const repo = resolve(import.meta.dirname, "../..");
const reference = join(repo, "cli/test/golden/carbon-react");
const installed = existsSync(join(repo, "examples/carbon-react/node_modules/@carbon/react"));

describe.skipIf(!installed)("asking again with the same design", { timeout: 300_000 }, () => {
  let server: { url: string; close: () => Promise<void> };
  const accounts = new Accounts(":memory:", { trial: 5, pro: 300 });
  const golden = readdirSync(reference).map((f) => ({ path: f, content: readFileSync(join(reference, f), "utf8") }));
  // Two answers: the first design's, and the one asked for under another name.
  const model = new ScriptedLlm([{ files: golden, notes: "" }, { files: golden.map((f) => ({ ...f, path: f.path.replace("OrderCard", "OrderPanel"), content: f.content.replaceAll("OrderCard", "OrderPanel") })), notes: "" }]);
  const auth = { clientId: "id", clientSecret: "secret", sessionSecret: "s3cret", origin: "http://localhost", secureCookies: false };
  let key = "";
  let me = 0;
  const figmaNode = orderCard({ font: "IBM Plex Sans", title: [20, 28], body: [14, 20], padding: 16, gap: 8 });
  const ask = async (name = "OrderCard") => (await fetch(`${server.url}/api/jobs`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, body: JSON.stringify({ project: "carbon-react", name, figmaNode }) })).json() as Promise<{ id: string; reused?: boolean; error?: string }>;
  const done = async (id: string) => {
    for (;;) {
      const job = await (await fetch(`${server.url}/api/jobs/${id}`)).json();
      if (job.state === "done" || job.state === "error") return job;
      await new Promise((r) => setTimeout(r, 1000));
    }
  };

  beforeAll(async () => {
    server = await startServer({ repoRoot: repo, llm: () => model, auth, accounts, runsPerHour: 100, log: () => {}, rerank: false }, 0);
    const account = accounts.signIn({ githubId: 9, login: "double-clicker" });
    me = account.id;
    key = accounts.createToken(account.id, "figma");
  });
  afterAll(() => server?.close());

  it("joins the job still running, returns the one that passed, and charges one generation for all of it", async () => {
    const first = await ask();
    const doubleClick = await ask();
    expect(doubleClick).toEqual({ id: first.id, reused: true });
    const job = await done(first.id);
    expect(["verified", "unchecked-remain"]).toContain(job.result.status);
    const later = await ask();
    expect(later).toEqual({ id: first.id, reused: true });
    expect(job.events.length).toBeGreaterThan(0);
    expect((await done(first.id)).events.map((e: { text: string }) => e.text)).toContain("Asked for again with the same design: this result, with no generation used.");
    expect(accounts.allowance(accounts.get(me)!).used).toBe(1);
  });

  it("generates afresh for another name: not the same request", async () => {
    const other = await ask("OrderPanel");
    expect(other.reused).toBeUndefined();
    await done(other.id);
    expect(accounts.allowance(accounts.get(me)!).used).toBe(2);
  });
});
