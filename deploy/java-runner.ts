// The Java runner: checks one generated Vaadin view per machine start. Vaadin runs views on the server, so the
// generated Java runs here, never on the main server. This machine holds no secrets and has no public address; before
// serving, it blocks all outgoing connections (only loopback and replies to the main server's requests pass); the app
// runs as an unprivileged user; and after a check the process exits, so Fly starts the next check from a fresh image.
// Run: node deploy/java-runner.ts   (TULPAR_RUNNER_LOCAL=1 on a developer machine: no firewall, no exit, own code only)
import { execFileSync } from "node:child_process";
import { createServer, type IncomingMessage } from "node:http";
import { resolve } from "node:path";
import { indexHere } from "../adapters/vaadin/src/components.ts";
import { check, tokens, type RunnerOptions, type Source } from "../adapters/vaadin/src/runner.ts";

const local = process.env.TULPAR_RUNNER_LOCAL === "1";
const root = resolve(import.meta.dirname, "..", "examples", "vaadin-aura");
const options: RunnerOptions = {
  root,
  javaHome: process.env.TULPAR_JAVA_HOME ?? "/opt/jdk",
  ...(process.env.TULPAR_RUNNER_UID && { uid: Number(process.env.TULPAR_RUNNER_UID), gid: Number(process.env.TULPAR_RUNNER_GID ?? process.env.TULPAR_RUNNER_UID) }),
};

// Fail closed: without the firewall, generated code could reach the network, so the runner does not serve.
if (!local) {
  for (const tool of ["iptables", "ip6tables"]) {
    for (const rule of [["-A", "OUTPUT", "-o", "lo", "-j", "ACCEPT"], ["-A", "OUTPUT", "-m", "conntrack", "--ctstate", "ESTABLISHED,RELATED", "-j", "ACCEPT"], ["-P", "OUTPUT", "DROP"]]) {
      execFileSync(tool, rule, { stdio: "inherit" });
    }
  }
  console.log("Outgoing connections blocked");
}

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 2 * 1024 * 1024) throw new Error("too large");
    chunks.push(c as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

let busy = false;
let indexCache: ReturnType<typeof indexHere> | undefined;

const server = createServer(async (req, res) => {
  const json = (status: number, value: unknown) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(value));
  try {
    if (req.method === "GET" && req.url === "/healthz") return json(200, { ok: true });
    if (req.method === "POST" && req.url === "/index") {
      const b = await body(req);
      indexCache ??= indexHere(root, String(b.version ?? ""));
      return json(200, indexCache);
    }
    if (req.method !== "POST" || (req.url !== "/check" && req.url !== "/tokens")) return json(404, { ok: false, log: "not found" });
    // One check per machine start: a machine that has run generated code never runs another.
    if (busy) return json(503, { ok: false, log: "This runner is busy." });
    busy = true;
    const b = await body(req);
    // A check can take a while; spaces before the JSON keep Fly's network from closing a quiet request.
    res.writeHead(200, { "content-type": "application/json" });
    const alive = setInterval(() => res.write(" "), 15_000);
    let result: unknown;
    try {
      result =
        req.url === "/check"
          ? await check(options, { sources: b.sources as Source[], view: String(b.view), frame: b.frame as { width: number; height: number }, scale: Number(b.scale ?? 1), tags: (b.tags ?? {}) as Record<string, string> })
          : { ok: true, tokens: await tokens(options, (b.runtime ?? {}) as never) };
    } catch (err) {
      result = { ok: false, log: (err as Error).message.split("\n")[0] };
    } finally {
      clearInterval(alive);
    }
    res.end(JSON.stringify(result), () => {
      if (local) busy = false;
      else setTimeout(() => process.exit(0), 200);
    });
  } catch (err) {
    json(400, { ok: false, log: (err as Error).message.split("\n")[0] });
  }
});
server.listen(Number(process.env.PORT ?? 8080), () => console.log("Java runner ready"));
