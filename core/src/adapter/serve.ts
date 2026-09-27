// Adapter side of the protocol, for adapters written in TypeScript.
// Adapters in other languages implement the same line-delimited JSON-RPC directly.

import { createInterface } from "node:readline";
import { ErrorCodes, type Methods, type MethodName, type Request } from "./protocol.ts";

export type Handlers = { [M in MethodName]?: (params: Methods[M]["params"]) => Promise<Methods[M]["result"]> | Methods[M]["result"] };

export function serve(handlers: Handlers): void {
  const out = (msg: object) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...msg }) + "\n");
  // stdout carries protocol messages only; route stray logging to stderr.
  console.log = console.error;
  const inFlight = new Set<Promise<void>>();

  createInterface({ input: process.stdin }).on("line", async (line) => {
    if (!line.trim()) return;
    let req: Request;
    try {
      req = JSON.parse(line);
    } catch {
      out({ id: null, error: { code: ErrorCodes.ParseError, message: "Invalid JSON" } });
      return;
    }
    const handler = handlers[req.method as MethodName] as ((p: unknown) => unknown) | undefined;
    if (req.method === "shutdown") {
      // Answer everything already received before exiting.
      await Promise.allSettled(inFlight);
      out({ id: req.id, result: null });
      process.exit(0);
    }
    if (!handler) {
      out({ id: req.id, error: { code: ErrorCodes.MethodNotFound, message: `Method not supported: ${req.method}` } });
      return;
    }
    const work = (async () => {
      try {
        out({ id: req.id, result: await handler(req.params) });
      } catch (err) {
        out({ id: req.id, error: { code: ErrorCodes.InternalError, message: err instanceof Error ? err.stack ?? err.message : String(err) } });
      }
    })();
    inFlight.add(work);
    await work;
    inFlight.delete(work);
  });
}
