// A published static site (a WebAssembly app) served on localhost for the length of a render: WebAssembly
// cannot load from a file. The render's browser allows this one origin and blocks every other host.

import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { extname, join, normalize } from "node:path";

const TYPES: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm", ".json": "application/json", ".css": "text/css", ".dat": "application/octet-stream", ".woff2": "font/woff2", ".png": "image/png", ".svg": "image/svg+xml" };

export async function serving<T>(site: string, fn: (url: string) => Promise<T>): Promise<T> {
  const base = normalize(site);
  const server: Server = createServer(async (req, res) => {
    const path = decodeURIComponent((req.url ?? "/").split("?")[0]!);
    const file = normalize(join(base, path === "/" ? "index.html" : path));
    if (!file.startsWith(base)) return void res.writeHead(403).end();
    try {
      const body = await readFile(file);
      res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" }).end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    return await fn(`http://127.0.0.1:${(server.address() as { port: number }).port}/`);
  } finally {
    await new Promise((r) => server.close(r));
  }
}
