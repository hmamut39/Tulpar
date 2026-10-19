// Generation jobs: queued and run one at a time (each builds and renders in Chromium),
// with progress events the page polls. Jobs are forgotten after an hour.

import { randomUUID } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { generateCommand } from "@tulpar/cli/generate";
import { generatePageCommand } from "@tulpar/cli/page";
import type { GenerationEvent, GenerationResult, Llm, LlmImage, OutputChoice, VerifyReport } from "@tulpar/core";

export interface JobInput {
  /** Where results go; default under out/. */
  resultsDir?: string;
  projectDir: string;
  name: string;
  /** Figma frame; absent in screenshot-only mode. */
  frame?: string;
  fileKey?: string;
  scale?: number;
  figmaToken?: string;
  image?: LlmImage;
  output?: OutputChoice;
  /** A whole page: split into sections, each generated and verified, then a page that places them. */
  page?: boolean;
}

export interface Job {
  id: string;
  input: JobInput;
  /** Jumps ahead of ordinary jobs in the queue (Pro accounts, invite codes). */
  priority?: boolean;
  /** What the design came from; kept after the image itself is dropped. */
  source: "figma" | "screenshot" | "both";
  state: "queued" | "running" | "done" | "error";
  createdAt: number;
  events: { at: number; text: string }[];
  result?: GenerationResult;
  png?: string;
  error?: string;
}

const KEEP_MS = 3_600_000;

export class JobQueue {
  readonly #jobs = new Map<string, Job>();
  readonly #waiting: Job[] = [];
  #running = false;
  readonly #repoRoot: string;
  readonly #llm: () => Llm | undefined;

  readonly #onFinish: ((job: Job, ms: number) => void) | undefined;
  #idle: (() => void)[] = [];

  readonly #rerank: boolean;

  constructor(options: { repoRoot: string; llm: () => Llm | undefined; onFinish?: (job: Job, ms: number) => void; rerank?: boolean }) {
    this.#repoRoot = options.repoRoot;
    this.#llm = options.llm;
    this.#rerank = options.rerank ?? true;
    this.#onFinish = options.onFinish;
  }

  /** Jobs waiting or running. */
  get pending(): number {
    return this.#waiting.length + (this.#running ? 1 : 0);
  }

  /** Resolves when nothing is running or waiting (for a graceful shutdown). */
  idle(): Promise<void> {
    return this.pending ? new Promise((r) => this.#idle.push(r)) : Promise.resolve();
  }

  /** Queues a job. A priority job (Pro, invite) waits only behind other priority jobs. */
  add(input: JobInput, options: { priority?: boolean } = {}): string {
    this.#sweep();
    const source = input.frame && input.image ? "both" : input.image ? "screenshot" : "figma";
    const id = randomUUID();
    // Each job writes to its own temporary folder, deleted when the job ends: results are served from memory.
    const job: Job = { id, input: { ...input, resultsDir: input.resultsDir ?? join(tmpdir(), "tulpar-results", id) }, source, state: "queued", createdAt: Date.now(), events: [], priority: !!options.priority };
    this.#jobs.set(job.id, job);
    const firstOrdinary = job.priority ? this.#waiting.findIndex((w) => !w.priority) : -1;
    if (firstOrdinary >= 0) this.#waiting.splice(firstOrdinary, 0, job);
    else this.#waiting.push(job);
    this.#log(job, this.#running ? "Queued behind another generation." : "Starting.");
    void this.#next();
    return job.id;
  }

  get(id: string): Job | undefined {
    return this.#jobs.get(id);
  }

  /** What the page sees. The Figma token and the image are never sent back. */
  view(job: Job) {
    return {
      id: job.id,
      state: job.state,
      name: job.input.name,
      events: job.events,
      ...(job.error && { error: job.error }),
      hasRender: !!job.png,
      ...(job.result && {
        result: {
          status: job.result.status,
          model: job.result.model,
          usage: job.result.usage,
          attempts: job.result.attempts.map((a) => ({ rejected: a.rejected, verdict: a.report?.verdict, failing: a.report?.checks.filter((c) => c.status === "fail").map((c) => c.summary) ?? [] })),
          files: job.result.files,
          report: job.result.report,
        },
      }),
    };
  }

  async #next(): Promise<void> {
    if (this.#running) return;
    const job = this.#waiting.shift();
    if (!job) return;
    this.#running = true;
    job.state = "running";
    const started = Date.now();
    try {
      const llm = this.#llm();
      const outcome = await (job.input.page ? generatePageCommand : generateCommand)(job.input.projectDir, {
        ...(job.input.frame && { frame: job.input.frame }),
        ...(job.input.fileKey && { fileKey: job.input.fileKey }),
        ...(job.input.scale && { scale: job.input.scale }),
        ...(job.input.figmaToken && { figmaToken: job.input.figmaToken }),
        name: job.input.name,
        out: resolve(this.#repoRoot, "out"),
        ...(job.input.resultsDir && { resultsDir: job.input.resultsDir }),
        cache: resolve(this.#repoRoot, ".cache/figma"),
        ...(job.input.image && { image: job.input.image }),
        ...(job.input.output && { output: job.input.output }),
        ...(llm && { llm }),
        quiet: true,
        ...(!this.#rerank && { noRerank: true }),
        onEvent: (e) => this.#log(job, describe(e)),
      });
      if (outcome.error) {
        job.state = "error";
        job.error = outcome.error;
      } else {
        job.state = "done";
        job.result = outcome.result!;
        if (outcome.png) job.png = outcome.png;
        this.#log(job, summary(outcome.result!));
      }
    } catch (err) {
      job.state = "error";
      job.error = err instanceof Error ? err.message : String(err);
    } finally {
      // The visitor's token and image are needed only while the job runs, and nothing they made stays on disk:
      // the job's results folder, the generated files in the project's workspace, and the build.
      delete job.input.figmaToken;
      delete job.input.image;
      for (const dir of [job.input.resultsDir, join(job.input.projectDir, ".tulpar", "generated", job.input.name), join(job.input.projectDir, ".tulpar", "build")]) {
        if (dir) rmSync(dir, { recursive: true, force: true });
      }
      // Figma data from the visitor's own file (its frames and their pictures) is theirs: cached for the run
      // only. The built-in design system's public kit stays cached for everyone. Jobs run one at a time.
      if (job.input.fileKey && job.input.fileKey !== kitFileKey(job.input.projectDir) && /^[\w-]+$/.test(job.input.fileKey)) {
        rmSync(resolve(this.#repoRoot, ".cache/figma", job.input.fileKey), { recursive: true, force: true });
      }
      this.#running = false;
      try {
        this.#onFinish?.(job, Date.now() - started);
      } catch {
        /* logging must never break the queue */
      }
      if (!this.#waiting.length) for (const r of this.#idle.splice(0)) r();
      void this.#next();
    }
  }

  #log(job: Job, text: string): void {
    job.events.push({ at: Date.now(), text });
  }

  #sweep(): void {
    for (const [id, job] of this.#jobs) if (Date.now() - job.createdAt > KEEP_MS && job.state !== "running") this.#jobs.delete(id);
  }
}

function describe(e: GenerationEvent): string {
  switch (e.type) {
    case "brief":
      return `Read the design: ${e.brief.instances.length} design-system instances, ${e.brief.tokens.length} colour variables.`;
    case "generating":
      return e.repair ? `Repairing (attempt ${e.attempt})…` : e.attempt === 1 ? "Writing the component…" : `Writing another draft (attempt ${e.attempt})…`;
    case "generated":
      return `Wrote ${e.files.join(", ") || "no files"}.`;
    case "verifying":
      return "Building, rendering and checking against the design…";
    case "verified":
      return verdictLine(e.report);
    case "section":
      return e.page ? `All ${e.total} sections done. Now the page that places them: ${e.name}.` : `Section ${e.index} of ${e.total}: ${e.name}.`;
  }
}

function verdictLine(r: VerifyReport): string {
  const failing = r.checks.filter((c) => c.status === "fail").map((c) => c.summary);
  return failing.length ? `Checks failed: ${failing.join("; ")}.` : "All checks that ran passed.";
}

function summary(r: GenerationResult): string {
  return { verified: "Done: verified.", "unchecked-remain": "Done: no check failed; some could not run (see report).", failed: "Done, but checks still fail after the last attempt (see report)." }[r.status];
}

/** The Figma file of the project's built-in design-system kit (tulpar.json figma.fileKey), shared by everyone. */
function kitFileKey(projectDir: string): string | undefined {
  try {
    return (JSON.parse(readFileSync(join(projectDir, "tulpar.json"), "utf8")) as { figma?: { fileKey?: string } }).figma?.fileKey;
  } catch {
    return undefined;
  }
}
