// The web API: its safety rules, and a full generation through it with a scripted model.

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { ScriptedLlm } from "@tulpar/core";
import { startServer } from "../src/server.ts";

const repo = resolve(import.meta.dirname, "../..");
const ready = existsSync(resolve(repo, "examples/carbon-react/node_modules/@carbon/react")) && existsSync(resolve(repo, "out/library.json")) && existsSync(resolve(repo, ".cache/figma/b8xYgmx2Js30XaldxPkOs9/nodes/410-13792.json"));
const FRAME = "https://www.figma.com/design/b8xYgmx2Js30XaldxPkOs9/Carbon?node-id=3906-50588&m=dev";

const tsx = `import { Button, ModalFooter } from "@carbon/react";
import "./ModalActions.css";
export default function ModalActions() {
  return (
    <ModalFooter data-figma-id="3906:50588">
      <Button kind="secondary" size="xl" data-figma-id="4122:87677">Button</Button>
      <Button kind="primary" size="xl" data-figma-id="4122:86445">Button</Button>
    </ModalFooter>
  );
}
`;
const answer = { files: [{ path: "ModalActions.tsx", content: tsx }, { path: "ModalActions.css", content: "/* none */\n" }, { path: "ModalActions.test.tsx", content: "// tests\n" }], notes: "" };

let server: { url: string; close: () => Promise<void> };
let llm: ScriptedLlm;
const post = (body: Record<string, unknown>) => fetch(`${server.url}/api/jobs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("web API", () => {
  beforeAll(async () => {
    llm = new ScriptedLlm([answer]);
    server = await startServer({ repoRoot: repo, llm: () => llm, accessCode: "open-sesame", runsPerHour: 2 }, 0);
  });
  afterAll(() => server.close());

  it("describes itself without secrets", async () => {
    const config = await (await fetch(`${server.url}/api/config`)).json();
    expect(config).toMatchObject({ accessCodeRequired: true, model: "scripted" });
    expect(config.projects.map((p: { id: string }) => p.id)).toEqual(expect.arrayContaining(["carbon", "carbon-react"]));
    expect(JSON.stringify(config)).not.toContain("open-sesame");
  });

  it("refuses without the access code, and explains bad input", async () => {
    expect((await post({ project: "carbon-react", figmaUrl: FRAME, name: "X" })).status).toBe(401);
    const bad = async (body: Record<string, unknown>) => (await (await post({ accessCode: "open-sesame", project: "carbon-react", figmaUrl: FRAME, name: "Card", ...body })).json()).error;
    expect(await bad({ figmaUrl: "https://example.com/x" })).toBe("That is not a Figma link.");
    expect(await bad({ figmaUrl: "https://www.figma.com/design/abc/Kit" })).toMatch(/points at the whole file/);
    expect(await bad({ name: "card" })).toMatch(/PascalCase/);
    expect(await bad({ project: "nope" })).toBe("Pick a project.");
    expect(await bad({ image: "data:text/html;base64,PGgxPg==" })).toMatch(/PNG, JPEG or WebP/);
    expect(await bad({ figmaUrl: "" })).toBe("Paste a Figma frame link, upload a screenshot, or both.");
    expect(await bad({ scale: 7 })).toMatch(/Scale must be/);
  });

  it("serves only its own files", async () => {
    expect((await fetch(`${server.url}/`)).headers.get("content-type")).toMatch(/text\/html/);
    expect((await fetch(`${server.url}/..%2F..%2Fpackage.json`)).status).toBe(404);
    expect((await fetch(`${server.url}/%2e%2e/src/server.ts`)).status).toBe(404);
  });

  it.skipIf(!ready)("runs a generation, never echoes the Figma token, and serves the render and the zip", async () => {
    const res = await post({ accessCode: "open-sesame", project: "carbon-react", figmaUrl: FRAME, name: "ModalActions", figmaToken: "figd_secret" });
    expect(res.status).toBe(202);
    const { id } = await res.json();
    let job: Record<string, any>;
    for (;;) {
      job = await (await fetch(`${server.url}/api/jobs/${id}`)).json();
      if (job.state === "done" || job.state === "error") break;
      await new Promise((r) => setTimeout(r, 500));
    }
    expect(job.state).toBe("done");
    expect(job.result.status).toBe("unchecked-remain");
    expect(job.result.report.checks.filter((c: { status: string }) => c.status === "fail")).toEqual([]);
    expect(JSON.stringify(job)).not.toContain("figd_secret");

    const png = await fetch(`${server.url}/api/jobs/${id}/render.png`);
    expect(png.headers.get("content-type")).toBe("image/png");
    const zip = unzipSync(new Uint8Array(await (await fetch(`${server.url}/api/jobs/${id}/download.zip`)).arrayBuffer()));
    expect(Object.keys(zip).sort()).toEqual(["ModalActions/ModalActions.css", "ModalActions/ModalActions.test.tsx", "ModalActions/ModalActions.tsx", "ModalActions/tulpar-report.json"]);
    expect(strFromU8(zip["ModalActions/ModalActions.tsx"]!)).toBe(tsx);
  }, 180_000);

  it("limits generations per visitor per hour", async () => {
    // Two runs per hour are allowed in this test server; earlier tests may have used one.
    let last = 0;
    for (let i = 0; i < 3; i++) last = (await post({ accessCode: "open-sesame", project: "carbon-react", figmaUrl: FRAME, name: "Card" })).status;
    expect(last).toBe(429);
  });
});
