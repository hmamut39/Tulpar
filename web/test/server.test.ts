// The web API: its safety rules, and a full generation through it with a scripted model.

import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { ScriptedLlm } from "@tulpar/core";
import { startServer } from "../src/server.ts";

const repo = resolve(import.meta.dirname, "../..");
const framePictured = existsSync(resolve(repo, ".cache/figma/b8xYgmx2Js30XaldxPkOs9/images/3906-50588@1x.png"));
const ready = existsSync(resolve(repo, "examples/carbon-react/node_modules/@carbon/react")) && existsSync(resolve(repo, "out/library.json")) && existsSync(resolve(repo, ".cache/figma/b8xYgmx2Js30XaldxPkOs9/nodes/410-13792.json"));
const FRAME = "https://www.figma.com/design/b8xYgmx2Js30XaldxPkOs9/Carbon?node-id=3906-50588&m=dev";

const tsx = `import { Button, ModalFooter } from "@carbon/react";
import "./ModalActions.css";
export default function ModalActions() {
  return (
    <ModalFooter data-figma-id="3906:50588">
      <Button kind="secondary" size="xl" data-figma-id="4122:87677">
        Button
      </Button>
      <Button kind="primary" size="xl" data-figma-id="4122:86445">
        Button
      </Button>
    </ModalFooter>
  );
}
`;
const answer = { files: [{ path: "ModalActions.tsx", content: tsx }, { path: "ModalActions.css", content: "/* none */\n" }, { path: "ModalActions.test.tsx", content: 'import { render, screen } from "@testing-library/react";\nimport ModalActions from "./ModalActions";\ndescribe("ModalActions", () => { it("shows two actions", () => { render(<ModalActions />); expect(screen.getAllByRole("button")).toHaveLength(2); }); });\n' }], notes: "" };

let server: { url: string; close: () => Promise<void> };
let llm: ScriptedLlm;
const logged: string[] = [];
const post = (body: Record<string, unknown>) => fetch(`${server.url}/api/jobs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("web API", () => {
  beforeAll(async () => {
    llm = new ScriptedLlm([answer]);
    server = await startServer({ repoRoot: repo, llm: () => llm, accessCode: "open-sesame", runsPerHour: 2, resultsRoot: resolve(tmpdir(), "tulpar-web-test"), log: (l) => logged.push(l), rerank: false }, 0);
    // The first config waits for every framework's adapter to say what it writes: slow on a busy machine.
    await fetch(`${server.url}/api/config`);
  }, 120_000);
  afterAll(() => server.close());

  it("describes itself without secrets", async () => {
    const config = await (await fetch(`${server.url}/api/config`)).json();
    expect(config).toMatchObject({ accessCodeRequired: true, model: "scripted" });
    expect(config.projects.map((p: { id: string }) => p.id)).toEqual(expect.arrayContaining(["carbon", "carbon-react"]));
    expect(JSON.stringify(config)).not.toContain("open-sesame");
    // The language and styling choices come from the adapters, the default first.
    expect(config.outputs.react[0]).toEqual({ language: "typescript", styling: "css" });
    expect(config.outputs.react).toContainEqual({ language: "javascript", styling: "emotion" });
    expect(config.outputs.angular.map((o: { language: string }) => o.language)).not.toContain("javascript");
    expect(config.outputs["web-components"]).toEqual([]);
    // A framework this machine cannot build is not offered: without the Flutter SDK, no Flutter project.
    if (!process.env.TULPAR_FLUTTER_SDK && !process.env.FLUTTER_ROOT && !(process.env.PATH ?? "").toLowerCase().includes("flutter")) {
      expect(config.projects.map((p: { adapter: string }) => p.adapter)).not.toContain("flutter");
    }
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
    expect(await bad({ project: "carbon-svelte", styling: "css-modules" })).toMatch(/does not write that language and styling/);
    expect(await bad({ project: "carbon", styling: "tailwind" })).toMatch(/does not write that language and styling/);
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
    expect(["verified", "unchecked-remain"]).toContain(job.result.status);
    expect(job.result.report.checks.find((c: { id: string }) => c.id === "visual").status).toBe(framePictured ? "pass" : "not-checked");
    expect(job.result.report.checks.filter((c: { status: string }) => c.status === "fail")).toEqual([]);
    expect(JSON.stringify(job)).not.toContain("figd_secret");
    // One usage line per job: what ran and how it went, never the token, the code or the files.
    const line = JSON.parse(logged.at(-1)!);
    expect(line).toMatchObject({ event: "job", project: "carbon-react", source: "figma", state: "done", status: job.result.status, attempts: 1 });
    expect(line.invite).toMatch(/^[a-f0-9]{8}$/);
    expect(logged.join()).not.toMatch(/figd_secret|open-sesame|ModalFooter/);

    const png = await fetch(`${server.url}/api/jobs/${id}/render.png`);
    expect(png.headers.get("content-type")).toBe("image/png");
    const zip = unzipSync(new Uint8Array(await (await fetch(`${server.url}/api/jobs/${id}/download.zip`)).arrayBuffer()));
    expect(Object.keys(zip).sort()).toEqual(["ModalActions/ModalActions.css", "ModalActions/ModalActions.test.tsx", "ModalActions/ModalActions.tsx", "ModalActions/tulpar-report.json"]);
    expect(strFromU8(zip["ModalActions/ModalActions.tsx"]!)).toBe(tsx);
    expect(job.result.report.checks.find((c: { id: string }) => c.id === "tests").summary).toMatch(/^1 of 1 generated tests pass/);

    // "Was this result useful?": once per result; the log notes the rating, never the comment's text.
    const rate = (body: Record<string, unknown>) => fetch(`${server.url}/api/jobs/${id}/feedback`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    expect((await rate({ rating: "sideways" })).status).toBe(400);
    expect((await rate({ rating: "down", comment: "the spacing was off" })).status).toBe(200);
    expect(JSON.parse(logged.at(-1)!)).toMatchObject({ event: "feedback", project: "carbon-react", rating: "down", comment: true });
    expect(logged.at(-1)).not.toContain("the spacing was off");
    expect((await fetch(`${server.url}/api/jobs/00000000-0000-0000-0000-000000000000/feedback`, { method: "POST", body: "{}" })).status).toBe(404);

    // Ask for a change: the files and the design the run read, with the request; checked again.
    expect(job.canChange).toBe(true);
    const ask = (jobId: string, body: Record<string, unknown>) => fetch(`${server.url}/api/jobs/${jobId}/change`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    expect((await ask("00000000-0000-0000-0000-000000000000", { accessCode: "open-sesame", request: "x" })).status).toBe(404);
    expect((await ask(id, { accessCode: "open-sesame", request: "  " })).status).toBe(400);
    expect((await ask(id, { request: "Make the buttons smaller." })).status).toBe(401);
    llm = new ScriptedLlm([{ ...answer, files: answer.files.map((f) => (f.path === "ModalActions.tsx" ? { ...f, content: tsx.replace(/size="xl"/g, 'size="lg"') } : f)) }]);
    const asked = await ask(id, { accessCode: "open-sesame", request: "Make the buttons smaller." });
    expect(asked.status).toBe(202);
    const changeId = (await asked.json()).id;
    let changed: Record<string, any>;
    for (;;) {
      changed = await (await fetch(`${server.url}/api/jobs/${changeId}`)).json();
      if (changed.state === "done" || changed.state === "error") break;
      await new Promise((r) => setTimeout(r, 500));
    }
    expect(changed).toMatchObject({ state: "done", changeOf: id, request: "Make the buttons smaller.", canChange: true });
    // The model saw the delivered files and the request, and no screenshot or Figma reading happened again.
    expect(llm.requests).toHaveLength(1);
    expect(llm.requests[0]!.text).toContain('size="xl"');
    expect(llm.requests[0]!.text).toContain("Make the buttons smaller.");
    expect(changed.result.files.find((f: { path: string }) => f.path === "ModalActions.tsx").content).toContain('size="lg"');
    // A smaller button no longer matches the design's: reported, and that is what was asked.
    expect(changed.result.status).toBe("verified");
    expect(changed.result.departures ?? []).toEqual(expect.arrayContaining(changed.result.report.checks.filter((c: { id: string; status: string }) => c.status === "fail").map((c: { id: string }) => c.id)));
  }, 300_000);

  it("limits generations per visitor per hour", async () => {
    // Two runs per hour are allowed in this test server; earlier tests may have used one.
    let last = 0;
    for (let i = 0; i < 3; i++) last = (await post({ accessCode: "open-sesame", project: "carbon-react", figmaUrl: FRAME, name: "Card" })).status;
    expect(last).toBe(429);
  });
});

describe("hosting rules", () => {
  let hosted: { url: string; close: () => Promise<void> };
  const lines: string[] = [];
  const send = (body: Record<string, unknown>, headers: Record<string, string> = {}) =>
    fetch(`${hosted.url}/api/jobs`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ project: "carbon-react", name: "Card", ...body }) });
  beforeAll(async () => {
    // A model that never answers keeps jobs pending, so queue and caps can be counted.
    const never = { name: "never", generate: () => new Promise<never>(() => {}) } as unknown as ScriptedLlm;
    hosted = await startServer({ repoRoot: repo, llm: () => never, accessCode: ["alice-1", "bob-2"], runsPerHour: 100, runsPerDay: 3, maxQueue: 2, log: (l) => lines.push(l) }, 0);
  });
  afterAll(() => hosted.close());

  it("answers a health check and sends security headers", async () => {
    const res = await fetch(`${hosted.url}/healthz`);
    expect(await res.json()).toMatchObject({ ok: true });
    const page = await fetch(`${hosted.url}/`);
    expect(page.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(page.headers.get("x-frame-options")).toBe("DENY");
    expect(page.headers.get("referrer-policy")).toBe("no-referrer");
    const head = await fetch(`${hosted.url}/`, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.headers.get("content-type")).toMatch(/text\/html/);
  });

  it("lets apps on other origins (the Figma plugin) call the API with a key, never with the site's cookie", async () => {
    const preflight = await fetch(`${hosted.url}/api/jobs`, { method: "OPTIONS", headers: { origin: "null", "access-control-request-headers": "authorization, content-type" } });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-headers")).toBe("authorization, content-type");
    expect(preflight.headers.get("access-control-allow-credentials")).toBeNull();
    expect((await fetch(`${hosted.url}/api/config`)).headers.get("access-control-allow-origin")).toBe("*");
    // Without a key, a cross-origin page cannot read the API's answers.
    expect((await fetch(`${hosted.url}/api/me`)).headers.get("access-control-allow-origin")).toBeNull();
    expect((await fetch(`${hosted.url}/api/me`, { headers: { authorization: "Bearer tlp_nope" } })).headers.get("access-control-allow-origin")).toBe("*");
    expect((await fetch(`${hosted.url}/`)).headers.get("access-control-allow-origin")).toBeNull();
  });

  it("accepts any invite code, and turns work away when the queue is full", async () => {
    expect((await send({ accessCode: "carol-3", figmaUrl: FRAME })).status).toBe(401);
    expect((await send({ accessCode: "alice-1", figmaUrl: FRAME })).status).toBe(202);
    expect((await send({ accessCode: "bob-2", figmaUrl: FRAME })).status).toBe(202);
    expect((await send({ accessCode: "bob-2", figmaUrl: FRAME })).status).toBe(503);
  });

  it("caps generations per day across all visitors", async () => {
    // Two accepted above; the queue is full, so the cap is checked first once it is reached.
    const capped = await startServer({ repoRoot: repo, llm: () => ({ name: "never", generate: () => new Promise<never>(() => {}) }) as unknown as ScriptedLlm, accessCode: "x", runsPerDay: 1, maxQueue: 10 }, 0);
    const go = () => fetch(`${capped.url}/api/jobs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accessCode: "x", project: "carbon-react", name: "Card", figmaUrl: FRAME }) });
    expect((await go()).status).toBe(202);
    const res = await go();
    expect(res.status).toBe(429);
    expect((await res.json()).error).toMatch(/today's generation limit/);
    await capped.close();
  }, 60_000);

  it("does not let a faked x-forwarded-for escape the hourly limit", async () => {
    const limited = await startServer({ repoRoot: repo, llm: () => ({ name: "never", generate: () => new Promise<never>(() => {}) }) as unknown as ScriptedLlm, accessCode: "x", runsPerHour: 1, maxQueue: 10 }, 0);
    const go = (ip: string) => fetch(`${limited.url}/api/jobs`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify({ accessCode: "x", project: "carbon-react", name: "Card", figmaUrl: FRAME }) });
    expect((await go("1.1.1.1")).status).toBe(202);
    expect((await go("2.2.2.2")).status).toBe(429);
    await limited.close();
  });
});
