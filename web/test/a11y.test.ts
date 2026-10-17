// Every page meets WCAG 2 A and AA (axe-core), in light and dark mode. Tulpar holds generated code to
// accessible markup; its own pages are held to the same standard.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Accounts } from "../src/accounts.ts";
import { startServer } from "../src/server.ts";

const repo = resolve(import.meta.dirname, "../..");
const axe = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
const PAGES = ["/", "/pricing", "/about", "/connect", "/terms", "/privacy", "/refunds"];

describe("accessibility of the web pages", { timeout: 120_000 }, () => {
  let server: { url: string; close: () => Promise<void> };
  let browser: Browser;
  beforeAll(async () => {
    // Sign-in on, as in production: the account area is part of every page.
    const auth = { clientId: "id", clientSecret: "secret", sessionSecret: "a11y", origin: "http://localhost", secureCookies: false };
    server = await startServer({ repoRoot: repo, llm: () => undefined, auth, accounts: new Accounts(":memory:"), log: () => {} }, 0);
    browser = await chromium.launch();
  });
  afterAll(async () => {
    await browser?.close();
    await server?.close();
    // Closing Chromium can be slow while the rest of the suite runs in parallel.
  }, 60_000);

  for (const scheme of ["light", "dark"] as const) {
    it(`has no WCAG A or AA violations in ${scheme} mode`, async () => {
      const page = await (await browser.newContext({ colorScheme: scheme })).newPage();
      const found: string[] = [];
      for (const path of PAGES) {
        await page.goto(server.url + path, { waitUntil: "networkidle" });
        await page.evaluate(axe);
        const result = await page.evaluate(() => (window as unknown as { axe: { run: (d: Document, o: object) => Promise<{ violations: { id: string; nodes: { target: string[] }[] }[] }> } }).axe.run(document, { runOnly: ["wcag2a", "wcag2aa"] }));
        for (const v of result.violations) found.push(`${path}: ${v.id} at ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(", ")}`);
      }
      expect(found).toEqual([]);
    });
  }
});
