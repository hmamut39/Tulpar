// Core side of the adapter protocol: start an adapter process and call it.

import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { PROTOCOL_VERSION, type AdapterManifest, type Methods, type MethodName, type Response } from "./protocol.ts";

export class AdapterError extends Error {
  readonly code: number;

  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

export class AdapterHost {
  readonly #proc: ChildProcess;
  readonly #pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  #nextId = 1;
  #stderr = "";
  /** Set once the adapter is stopping or gone; later calls fail at once instead of hanging. */
  #closed?: AdapterError;
  manifest?: AdapterManifest;

  private constructor(proc: ChildProcess) {
    this.#proc = proc;
    createInterface({ input: proc.stdout! }).on("line", (line) => this.#onLine(line));
    proc.stderr!.on("data", (chunk) => (this.#stderr = (this.#stderr + chunk).slice(-4000)));
    proc.on("exit", (code) => {
      const err = new AdapterError(-1, `Adapter exited (code ${code}). ${this.#stderr.trim()}`);
      this.#closed ??= err;
      for (const p of this.#pending.values()) p.reject(err);
      this.#pending.clear();
    });
  }

  /** Start an adapter executable and perform the initialize handshake. */
  static async start(command: string, args: string[], cwd?: string): Promise<AdapterHost> {
    const proc = spawn(command, args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
    const host = new AdapterHost(proc);
    host.manifest = await host.call("initialize", { protocolVersion: PROTOCOL_VERSION });
    if (host.manifest.protocolVersion !== PROTOCOL_VERSION) {
      await host.stop();
      throw new AdapterError(-1, `Adapter ${host.manifest.id} speaks protocol ${host.manifest.protocolVersion}, core speaks ${PROTOCOL_VERSION}.`);
    }
    return host;
  }

  call<M extends MethodName>(method: M, params: Methods[M]["params"]): Promise<Methods[M]["result"]> {
    if (this.#closed) return Promise.reject(this.#closed);
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.#proc.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }

  async stop(): Promise<void> {
    if (this.#closed) return;
    try {
      await this.call("shutdown", {});
    } finally {
      this.#closed ??= new AdapterError(-1, "Adapter was stopped.");
      this.#proc.stdin!.end();
    }
  }

  #onLine(line: string): void {
    if (!line.trim()) return;
    let msg: Response;
    try {
      msg = JSON.parse(line);
    } catch {
      this.#stderr += `\n[non-JSON on stdout] ${line.slice(0, 200)}`;
      return;
    }
    const pending = this.#pending.get(msg.id);
    if (!pending) return;
    this.#pending.delete(msg.id);
    if (msg.error) pending.reject(new AdapterError(msg.error.code, msg.error.message));
    else pending.resolve(msg.result);
  }
}
