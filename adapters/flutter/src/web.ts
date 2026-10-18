// A Flutter web build, served on localhost to headless Chromium with every other host blocked:
// generated Dart runs here, in the browser, and reaches nothing.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium, type Browser, type Page } from "playwright";

const TYPES: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm", ".json": "application/json", ".png": "image/png", ".otf": "font/otf", ".ttf": "font/ttf", ".frag": "application/octet-stream" };

let browser: Browser | undefined;

export async function closeBrowser(): Promise<void> {
  await browser?.close();
  browser = undefined;
}

/** Opens the built app (a directory with index.html) at the given size, runs `fn` on the page, and cleans up. */
export async function withBuild<T>(dir: string, viewport: { width: number; height: number; scale?: number }, fn: (page: Page, blocked: Set<string>) => Promise<T>): Promise<T> {
  const root = normalize(dir);
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent((req.url ?? "/").split("?")[0]!);
    const file = normalize(join(root, path === "/" ? "index.html" : path));
    if (!file.startsWith(root)) {
      res.writeHead(403).end();
      return;
    }
    try {
      const body = await readFile(file);
      res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" }).end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  browser ??= await chromium.launch({ args: ["--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1"] });
  const context = await browser.newContext({ viewport: { width: Math.ceil(viewport.width), height: Math.ceil(viewport.height) }, deviceScaleFactor: viewport.scale ?? 1 });
  const blocked = new Set<string>();
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "127.0.0.1" && url.port === String(port)) return route.continue();
    blocked.add(url.host);
    return route.abort();
  });
  try {
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${port}/`);
    return await fn(page, blocked);
  } finally {
    await context.close();
    server.close();
  }
}
