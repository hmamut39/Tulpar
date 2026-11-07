// The Java runner's work: compile a generated Vaadin view, start the app around it, draw it in headless Chromium,
// and stop the app. Vaadin runs views on the server, so generated Java runs here, which is why this code runs
// only on the runner machine: no secrets, outgoing network blocked, the app started as an unprivileged user, and the
// machine started afresh for every check (deploy/java-runner.ts). It is never run on the main server.

import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { delimiter, join } from "node:path";
import type { RenderResult } from "@tulpar/core";
import { FRAME_ID, probeTokens, render as renderPage, type FrameworkHooks, type RuntimeTokenConfig } from "@tulpar/web-kit";

export interface Source {
  name: string;
  content: string;
}

export interface RunnerOptions {
  /** The example project, built: target/classes and target/cp.txt. */
  root: string;
  javaHome: string;
  /** Run the app as this user and group (the runner's unprivileged user). */
  uid?: number;
  gid?: number;
}

/** Generated views live in this package, a sub-package of the app, so Spring and Vaadin find their routes. */
export const PACKAGE = "app.generated";

/** The view's package line, whatever the model wrote: the harness imports it from here. */
export function inPackage(source: string): string {
  const body = source.replace(/^\s*package\s+[\w.]+\s*;\s*/m, "");
  return `package ${PACKAGE};\n\n${body.trimStart()}`;
}

/** javac reports "Card.java:12: error: cannot find symbol" then the line and the symbol: kept with their file and line. */
export function compileErrors(output: string): string {
  const lines = output.split(/\r?\n/);
  const out: string[] = [];
  for (let i = 0; i < lines.length && out.length < 12; i++) {
    const m = /([A-Za-z]\w*\.java):(\d+): error: (.*)$/.exec(lines[i]!);
    if (!m) continue;
    const symbol = lines.slice(i + 1, i + 5).find((l) => /^\s*symbol:/.test(l))?.trim();
    out.push(`${m[1]}:${m[2]}: ${m[3]}${symbol ? ` (${symbol})` : ""}`);
  }
  return out.join("\n");
}

/** The route that shows one view at the Figma frame's size. */
export function harness(view: string, frame: { width: number; height: number }): string {
  return `package ${PACKAGE};

import com.vaadin.flow.component.html.Div;
import com.vaadin.flow.router.Route;

/** Written by Tulpar: shows one view at the Figma frame's size. */
@Route("")
public class TulparHarness extends Div {
    public TulparHarness() {
        Div frame = new Div();
        frame.setId("${FRAME_ID}");
        frame.getStyle().set("position", "relative").set("overflow", "hidden").set("width", "${frame.width}px").set("height", "${frame.height}px");
        frame.add(new ${view}());
        add(frame);
        getStyle().set("margin", "0").set("padding", "0");
    }
}
`;
}

interface Run {
  code: number | null;
  out: string;
}

function run(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, timeoutMs: number, user?: { uid?: number; gid?: number }): Promise<Run> {
  return new Promise((done) => {
    const child = spawn(command, args, { cwd, env, ...(user?.uid !== undefined && { uid: user.uid, gid: user.gid }) });
    let out = "";
    child.stdout.on("data", (d) => (out = (out + d).slice(-60_000)));
    child.stderr.on("data", (d) => (out = (out + d).slice(-60_000)));
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      done({ code: null, out: err.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      done({ code, out });
    });
  });
}

/** Only what Java needs: no secrets reach a compiler or an app that runs generated code. */
function bareEnv(o: RunnerOptions): NodeJS.ProcessEnv {
  return {
    PATH: [join(o.javaHome, "bin"), "/usr/bin", "/bin"].join(delimiter),
    JAVA_HOME: o.javaHome,
    HOME: "/tmp",
    ...(process.platform === "win32" && { SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP }),
  };
}

const java = (o: RunnerOptions, tool: "java" | "javac") => join(o.javaHome, "bin", process.platform === "win32" ? `${tool}.exe` : tool);

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer().listen(0, "127.0.0.1", () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });
}

/** Compiles the view and its harness against the built app; returns the class folder or the compiler's errors. */
export async function compile(o: RunnerOptions, sources: Source[], view: string, frame: { width: number; height: number }, job: string): Promise<{ ok: true; classes: string } | { ok: false; log: string }> {
  const dir = join(o.root, ".tulpar", "jobs", job);
  rmSync(dir, { recursive: true, force: true });
  const src = join(dir, "src");
  const classes = join(dir, "classes");
  mkdirSync(src, { recursive: true });
  mkdirSync(classes, { recursive: true });
  const files: string[] = [];
  for (const s of sources) {
    if (!/^[A-Z]\w*\.java$/.test(s.name)) return { ok: false, log: `not a Java source file name: ${s.name}` };
    writeFileSync(join(src, s.name), inPackage(s.content));
    files.push(join(src, s.name));
  }
  writeFileSync(join(src, "TulparHarness.java"), harness(view, frame));
  files.push(join(src, "TulparHarness.java"));
  const cp = [join(o.root, "target", "classes"), readFileSync(join(o.root, "target", "cp.txt"), "utf8").trim()].join(delimiter);
  // -proc:none: no annotation processor from the classpath runs while compiling.
  const r = await run(java(o, "javac"), ["-proc:none", "-encoding", "UTF-8", "-nowarn", "-d", classes, "-cp", cp, ...files], dir, bareEnv(o), 180_000);
  if (r.code !== 0) return { ok: false, log: compileErrors(r.out) || r.out.slice(-1500) || `javac failed (exit ${r.code})` };
  return { ok: true, classes };
}

/** Starts the app with the compiled view; resolves with its address once it answers, or its log if it does not. */
export async function start(o: RunnerOptions, classes: string): Promise<{ url: string; app: ChildProcess } | { log: string }> {
  const port = await freePort();
  const cp = [classes, join(o.root, "target", "classes"), readFileSync(join(o.root, "target", "cp.txt"), "utf8").trim()].join(delimiter);
  const app = spawn(java(o, "java"), ["-Xmx512m", "-cp", cp, "-Dvaadin.productionMode=true", "app.Application", `--server.port=${port}`, "--server.address=127.0.0.1"], {
    cwd: o.root,
    env: bareEnv(o),
    ...(o.uid !== undefined && { uid: o.uid, gid: o.gid }),
  });
  let log = "";
  app.stdout!.on("data", (d) => (log = (log + d).slice(-20_000)));
  app.stderr!.on("data", (d) => (log = (log + d).slice(-20_000)));
  const url = `http://127.0.0.1:${port}/`;
  for (let i = 0; i < 120; i++) {
    if (app.exitCode !== null) break;
    const ok = await fetch(url, { signal: AbortSignal.timeout(2000) }).then((r) => r.ok, () => false);
    if (ok) return { url, app };
    await new Promise((r) => setTimeout(r, 500));
  }
  app.kill("SIGKILL");
  const cause = log.split(/\r?\n/).filter((l) => /Caused by:|Exception|ERROR/.test(l)).slice(-3).join(" ").slice(0, 1200);
  return { log: `The view did not start: ${cause || "the app did not answer within a minute"}` };
}

/** Vaadin draws its components as custom elements; each Java class names its element with @Tag. */
export function vaadinHooks(tags: Record<string, string>): FrameworkHooks {
  return {
    async settle(page, frameId) {
      const drawn = await page
        .waitForFunction((id) => (document.getElementById(id)?.childElementCount ?? 0) > 0, frameId, { timeout: 60_000 })
        .then(() => true)
        .catch(() => false);
      await page.evaluate(async () => {
        // A hyphenated name may never be defined (a plain element of that name): wait a few seconds at most.
        const names = [...new Set([...document.querySelectorAll("*")].map((e) => e.localName).filter((n) => n.includes("-")))];
        await Promise.race([Promise.all(names.map((n) => customElements.whenDefined(n))), new Promise((r) => setTimeout(r, 5000))]);
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      });
      return drawn ? [] : ["The Vaadin view rendered nothing into the frame."];
    },
    identify(page) {
      return page.evaluate((tags) => {
        const out: Record<string, { component: string; defined: boolean }> = {};
        for (const el of document.querySelectorAll<HTMLElement>("[data-figma-id]")) {
          const tag = el.localName;
          out[el.dataset.figmaId!] = { component: tags[tag] ?? tag, defined: !tag.includes("-") || !!customElements.get(tag) };
        }
        return out;
      }, tags);
    },
  };
}

/** One check: compile, start, draw, stop. */
export async function check(o: RunnerOptions, input: { sources: Source[]; view: string; frame: { width: number; height: number }; scale: number; tags: Record<string, string> }): Promise<{ ok: false; log: string } | { ok: true; render: RenderResult }> {
  const job = `job-${Date.now()}`;
  const compiled = await compile(o, input.sources, input.view, input.frame, job);
  if (!compiled.ok) return compiled;
  const started = await start(o, compiled.classes);
  if ("log" in started) return { ok: false, log: started.log };
  try {
    const render = await renderPage({ artifact: started.url, entry: `${input.view}.java`, width: input.frame.width, height: input.frame.height, scale: input.scale } as never, {}, "aura", vaadinHooks(input.tags));
    return { ok: true, render };
  } finally {
    started.app.kill("SIGKILL");
  }
}

/** The theme's variables, read from an empty view. */
export async function tokens(o: RunnerOptions, config: RuntimeTokenConfig): Promise<unknown> {
  const empty = { name: "TulparEmpty.java", content: "import com.vaadin.flow.component.html.Div;\n\npublic class TulparEmpty extends Div {}\n" };
  const compiled = await compile(o, [empty], "TulparEmpty", { width: 200, height: 200 }, "tokens");
  if (!compiled.ok) throw new Error(compiled.log);
  const started = await start(o, compiled.classes);
  if ("log" in started) throw new Error(started.log);
  try {
    return await probeTokens(started.url, {}, vaadinHooks({}), config);
  } finally {
    started.app.kill("SIGKILL");
  }
}
