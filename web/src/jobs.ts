// Generation jobs: queued and run one at a time (each builds and renders in Chromium),
// with progress events the page polls. Jobs are forgotten after an hour.

import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { generateCommand } from "@tulpar/cli/generate";
import type { GenerationEvent, GenerationResult, Llm, LlmImage, VerifyReport } from "@tulpar/core";

export interface JobInput {
  projectDir: string;
  name: string;
  frame: string;
  fileKey: string;
  figmaToken?: string;
  image?: LlmImage;
}

export interface Job {
  id: string;
  input: JobInput;
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

  constructor(options: { repoRoot: string; llm: () => Llm | undefined }) {
    this.#repoRoot = options.repoRoot;
    this.#llm = options.llm;
  }

  add(input: JobInput): string {
    this.#sweep();
    const job: Job = { id: randomUUID(), input, state: "queued", createdAt: Date.now(), events: [] };
    this.#jobs.set(job.id, job);
    this.#waiting.push(job);
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
    try {
      const llm = this.#llm();
      const outcome = await generateCommand(job.input.projectDir, {
        frame: job.input.frame,
        fileKey: job.input.fileKey,
        ...(job.input.figmaToken && { figmaToken: job.input.figmaToken }),
        name: job.input.name,
        out: resolve(this.#repoRoot, "out"),
        cache: resolve(this.#repoRoot, ".cache/figma"),
        ...(job.input.image && { image: job.input.image }),
        ...(llm && { llm }),
        quiet: true,
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
      // The visitor's token and image are needed only while the job runs.
      delete job.input.figmaToken;
      delete job.input.image;
      this.#running = false;
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
      return e.attempt === 1 ? "Writing the component…" : `Repairing (attempt ${e.attempt})…`;
    case "generated":
      return `Wrote ${e.files.join(", ") || "no files"}.`;
    case "verifying":
      return "Building, rendering and checking against the design…";
    case "verified":
      return verdictLine(e.report);
  }
}

function verdictLine(r: VerifyReport): string {
  const failing = r.checks.filter((c) => c.status === "fail").map((c) => c.summary);
  return failing.length ? `Checks failed: ${failing.join("; ")}.` : "All checks that ran passed.";
}

function summary(r: GenerationResult): string {
  return { verified: "Done: verified.", "unchecked-remain": "Done: no check failed; some could not run (see report).", failed: "Done, but checks still fail after the last attempt (see report)." }[r.status];
}
