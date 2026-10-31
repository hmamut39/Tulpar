// The build machine for Kotlin: compiles generated Compose components for the main server, which draws them in its
// sandboxed browser. The compiler needs more memory than the main server has, and more disk than its image can hold.
// It holds no secrets, is reachable only on Fly's private network, runs no generated code, and keeps nothing asked of
// it. Run: node deploy/compose-builder.ts
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { promisify } from "node:util";
import { gzip } from "node:zlib";
import { resolve } from "node:path";
import { compileHere, readSite, sourceFolder, writeSources, type RemoteSource } from "../adapters/compose/src/build.ts";
import { indexHere } from "../adapters/compose/src/components.ts";

const root = resolve(import.meta.dirname, "..", "examples", "compose-material");
const LIMIT = 4 * 1024 * 1024;

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > LIMIT) throw new Error("too large");
    chunks.push(c as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

async function send(res: ServerResponse, status: number, value: unknown): Promise<void> {
  const zipped = await promisify(gzip)(JSON.stringify(value));
  res.writeHead(status, { "content-type": "application/json", "content-encoding": "gzip" }).end(zipped);
}

// One compile at a time: they share the project's folder and the compiler's memory.
let queue: Promise<unknown> = Promise.resolve();
const inTurn = <T>(fn: () => Promise<T>): Promise<T> => {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
};

createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/healthz") return await send(res, 200, { ok: true });
    if (req.method === "POST" && req.url === "/index") {
      const b = await body(req);
      return await send(res, 200, indexHere(root, b.library as { module: string; name: string; version: string }));
    }
    if (req.method === "POST" && req.url === "/compile") {
      const b = await body(req);
      const result = await inTurn(async () => {
        writeSources(sourceFolder(root), b.sources as RemoteSource[]);
        const built = await compileHere(root, String(b.name));
        return built.ok ? { ok: true, log: built.log, files: readSite(built.dir) } : { ok: false, log: built.log };
      });
      return await send(res, 200, result);
    }
    res.writeHead(404).end();
  } catch (err) {
    await send(res, 400, { ok: false, log: (err as Error).message.split("\n")[0] });
  }
}).listen(Number(process.env.PORT ?? 8080), () => console.log("Compose build machine ready"));
