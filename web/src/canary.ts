// The weekly drift check. Models change without notice; a drop in quality should show here before users see it.
// Once every `everyDays` days the server generates the order card (cli/src/order-card.ts: our own design, in the
// repository, no Figma access needed) with the real model on three projects, one per framework, through the
// ordinary job queue, and records how each went. The dashboard shows the history and warns when a project that
// passed last time now fails. About $1 a run. On only when TULPAR_CANARY_DAYS is set (fly.toml).

import { join } from "node:path";
import { orderCard, type Scale } from "@tulpar/cli/order-card";
import type { Accounts } from "./accounts.ts";
import type { JobQueue } from "./jobs.ts";

/** One project per framework, each card drawn in sizes its design system's tokens have (as the golden gate's). */
export const CANARY: { project: string; scale: Scale }[] = [
  { project: "carbon-react", scale: { font: "IBM Plex Sans", title: [20, 28], body: [14, 20], padding: 16, gap: 8 } },
  { project: "element-plus", scale: { font: "Inter", title: [20, 24], body: [14, 24], padding: 20, gap: 0 } },
  { project: "carbon-svelte", scale: { font: "IBM Plex Sans", title: [20, 28], body: [14, 20], padding: 16, gap: 8 } },
];

export interface CanaryOptions {
  repoRoot: string;
  queue: JobQueue;
  accounts: Accounts;
  everyDays: number;
  log: (line: string) => void;
  /** The canary's own job ids, so they are kept out of the users' numbers. */
  ours: Set<string>;
  /** How often to look whether a run is due (default an hour). */
  pollMs?: number;
  /**
   * The site's public address. Fly stops the machine when no one is connected, and no one watches a drift run:
   * while it runs, the server asks its own public address for its config every 30 s, which the proxy counts.
   */
  keepAliveUrl?: string;
  now?: () => number;
}

/** Runs the check whenever it is due; returns a function that stops it. */
export function startCanary(o: CanaryOptions): () => void {
  let running = false;
  const now = o.now ?? Date.now;
  const tick = async () => {
    if (running) return;
    const last = o.accounts.lastCanary();
    if (last && now() - Date.parse(last) < o.everyDays * 86_400_000) return;
    running = true;
    try {
      await runCanary(o);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), o.pollMs ?? 3_600_000);
  timer.unref();
  // A first look a few minutes after start, once the server has settled (a deploy restarts it).
  const first = setTimeout(() => void tick(), Math.min(o.pollMs ?? 600_000, 600_000));
  first.unref();
  return () => {
    clearInterval(timer);
    clearTimeout(first);
  };
}

/** One run: each project in turn, through the ordinary queue (one job at a time), each result recorded. */
export async function runCanary(o: CanaryOptions): Promise<void> {
  const at = new Date((o.now ?? Date.now)()).toISOString();
  const awake = o.keepAliveUrl ? setInterval(() => void fetch(`${o.keepAliveUrl}/api/config`).catch(() => {}), 30_000) : undefined;
  try {
    await runEach(o, at);
  } finally {
    if (awake) clearInterval(awake);
  }
}

async function runEach(o: CanaryOptions, at: string): Promise<void> {
  for (const c of CANARY) {
    const card = orderCard(c.scale);
    const id = o.queue.add({ projectDir: join(o.repoRoot, "examples", c.project), name: "OrderCard", frame: card.document.id, node: card });
    o.ours.add(id);
    const job = await finished(o.queue, id);
    const r = job?.result;
    const failing = r?.report?.checks.filter((x) => x.status === "fail").map((x) => x.id) ?? [];
    const firstPass = r ? !r.attempts[0]?.rejected.length && !!r.attempts[0]?.report && !r.attempts[0].report.checks.some((x) => x.status === "fail") : false;
    o.accounts.recordCanary({ at, project: c.project, status: r?.status ?? job?.state ?? "lost", firstPass, attempts: r?.attempts.length ?? 0, failing, tokens: r ? r.usage.inputTokens + r.usage.outputTokens : 0 });
    o.log(JSON.stringify({ event: "canary", at, project: c.project, status: r?.status ?? job?.state ?? "lost", firstPass, failing }));
  }
}

async function finished(queue: JobQueue, id: string) {
  for (;;) {
    const job = queue.get(id);
    if (!job || (job.state !== "queued" && job.state !== "running")) return job;
    await new Promise((r) => setTimeout(r, 5_000));
  }
}
