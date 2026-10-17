// The server starts as production starts it: run as a program, not imported by a test.

import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("the server as a program", () => {
  it("starts and answers its health check", async () => {
    const proc = spawn(process.execPath, [resolve(import.meta.dirname, "../src/server.ts")], { env: { ...process.env, PORT: "0", NODE_ENV: "development", TULPAR_ACCESS_CODES: "x" }, stdio: ["ignore", "pipe", "pipe"] });
    try {
      const url = await new Promise<string>((ok, fail) => {
        let out = "";
        const take = (d: Buffer) => {
          out += d;
          const m = out.match(/Tulpar web page: (http:\/\/\S+)/);
          if (m) ok(m[1]!);
        };
        proc.stdout.on("data", take);
        proc.stderr.on("data", take);
        proc.on("exit", (code) => fail(new Error(`exited ${code}: ${out.slice(-600)}`)));
      });
      expect((await fetch(`${url}/healthz`)).status).toBe(200);
    } finally {
      proc.kill();
    }
  }, 60_000);
});
