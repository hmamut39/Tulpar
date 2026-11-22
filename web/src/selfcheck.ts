// The self-check after a deploy, for the projects whose code builds on private machines CI cannot reach (Compose's
// builder, Vaadin's Java runner): the server, which can reach them, verifies each reference order card
// (cli/test/golden/<reference>) against its design. It must pass every check that runs, and the same card with a
// hard-coded colour must fail. No model runs. It takes the job queue to itself, so it never builds beside a
// generation, keeps the machine awake while it runs, and logs one line per project, with what failed and the
// design system's type and spacing values, so a reference can be tuned to them.
// On when TULPAR_SELFCHECK is set (fly.toml).

import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { orderCard, type Scale } from "@tulpar/cli/order-card";
import { loadContext, verifyEntry } from "@tulpar/cli/pipeline";
import { loadProject, withAdapter } from "@tulpar/cli/project";
import type { VerifyReport } from "@tulpar/core";

export interface SelfCheckCase {
  reference: string;
  project: string;
  entry: string;
  test?: string;
  scale: Scale;
  /** The reference with one hard-coded colour, in its own language. */
  colour: (files: Record<string, string>) => Record<string, string>;
}

export const SELF_CHECKS: SelfCheckCase[] = [
  {
    // Material 3's default theme, as Flutter's: titleLarge 22/28 onSurface, bodyMedium 14/20 onSurfaceVariant, on surface.
    reference: "compose",
    project: "compose-material",
    entry: "OrderCard.kt",
    test: "OrderCardTest.kt",
    scale: { font: "Roboto", title: [22, 28], body: [14, 20], padding: 16, gap: 8, colors: [[0.1137, 0.1059, 0.1255], [0.2863, 0.2706, 0.3098]], background: [0.9961, 0.9686, 1] },
    colour: (f) => ({ ...f, "OrderCard.kt": f["OrderCard.kt"]!.replace("import androidx.compose.ui.Modifier", "import androidx.compose.ui.Modifier\nimport androidx.compose.ui.graphics.Color").replace("color = MaterialTheme.colorScheme.onSurface,", "color = Color(0xFF1D1B20),") }),
  },
  {
    // Vaadin with Aura: the values are read from the runner; the scale is tuned to them from this check's own log.
    reference: "vaadin",
    project: "vaadin-aura",
    entry: "OrderCard.java",
    test: "OrderCardTest.java",
    scale: { font: "Inter", title: [20, 26], body: [14, 20], padding: 16, gap: 8, weights: [600, 400], colors: [[0.0941, 0.0941, 0.1059], [0.0941, 0.0941, 0.1059]] },
    colour: (f) => ({ ...f, "OrderCard.java": f["OrderCard.java"]!.replace('.set("margin", "0")\n                .set("font-size", "var(--aura-font-size-xl)")', '.set("margin", "0")\n                .set("color", "#18181b")\n                .set("font-size", "var(--aura-font-size-xl)")') }),
  },
];

export interface SelfCheckOptions {
  repoRoot: string;
  exclusive: <T>(fn: () => Promise<T>) => Promise<T>;
  log: (line: string) => void;
  /** The site's public address, called every 30 s while the check runs so Fly keeps the machine up. */
  keepAliveUrl?: string;
  /** Delay after start (default 2 minutes, once the server has settled). */
  delayMs?: number;
  cases?: SelfCheckCase[];
}

async function verifyFiles(repoRoot: string, c: SelfCheckCase, name: string, files: Record<string, string>): Promise<{ report: VerifyReport; tokens: string[] }> {
  const root = join(repoRoot, "examples", c.project);
  const dir = join(root, ".tulpar", "selfcheck", name);
  mkdirSync(dir, { recursive: true });
  for (const [f, content] of Object.entries(files)) writeFileSync(join(dir, f), content);
  const rel = (f: string) => `.tulpar/selfcheck/${name}/${f}`;
  const project = await loadProject(root);
  try {
    return await withAdapter(project, async (host) => {
      const ctx = await loadContext(host, project, { frame: "900:1", node: orderCard(c.scale) }, join(repoRoot, "out"), join(repoRoot, ".cache/figma"));
      const { report } = await verifyEntry(host, project, ctx, rel(c.entry), undefined, c.test ? rel(c.test) : undefined);
      // The design system's type and spacing values, for tuning the reference's scale.
      const tokens = (ctx.tokens?.tokens ?? [])
        .filter((t) => /font-?size|line-?height|font-?weight|gap|padding|spac/i.test(t.name))
        .flatMap((t) => {
          const v = t.values.default ?? Object.values(t.values)[0];
          return v?.kind === "dimension" ? [`${t.name}=${Math.round(v.points * 10) / 10}`] : v?.kind === "number" ? [`${t.name}=${v.value}`] : [];
        })
        .slice(0, 60);
      return { report, tokens };
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** One self-check: each case in turn, with the queue to itself. */
export async function runSelfCheck(o: SelfCheckOptions): Promise<{ reference: string; ok: boolean }[]> {
  const awake = o.keepAliveUrl ? setInterval(() => void fetch(`${o.keepAliveUrl}/api/config`).catch(() => {}), 30_000) : undefined;
  const results: { reference: string; ok: boolean }[] = [];
  try {
    for (const c of o.cases ?? SELF_CHECKS) {
      await o.exclusive(async () => {
        const started = Date.now();
        try {
          const golden = join(o.repoRoot, "cli", "test", "golden", c.reference);
          const files = Object.fromEntries(readdirSync(golden).map((f) => [f, readFileSync(join(golden, f), "utf8")]));
          const { report, tokens } = await verifyFiles(o.repoRoot, c, "reference", files);
          const failing = report.checks.filter((x) => x.status === "fail");
          const colour = (await verifyFiles(o.repoRoot, c, "colour", c.colour(files))).report;
          const caught = colour.checks.find((x) => x.id === "colors")?.status === "fail";
          const ok = !failing.length && caught;
          results.push({ reference: c.reference, ok });
          o.log(
            JSON.stringify({
              event: "selfcheck",
              reference: c.reference,
              ok,
              seconds: Math.round((Date.now() - started) / 1000),
              passed: report.checks.filter((x) => x.status === "pass").map((x) => x.id),
              notChecked: report.checks.filter((x) => x.status === "not-checked").map((x) => `${x.id}: ${x.summary}`),
              failing: failing.map((x) => ({ id: x.id, summary: x.summary, details: x.details.filter((d) => d.startsWith("✗")).slice(0, 4) })),
              colourCaught: caught,
              tokens,
            }),
          );
        } catch (err) {
          results.push({ reference: c.reference, ok: false });
          o.log(JSON.stringify({ event: "selfcheck", reference: c.reference, ok: false, error: (err as Error).message.slice(0, 400) }));
        }
      });
    }
  } finally {
    if (awake) clearInterval(awake);
  }
  return results;
}

/** Runs the self-check once, a while after the server starts; returns a function that cancels it. */
export function startSelfCheck(o: SelfCheckOptions): () => void {
  const timer = setTimeout(() => void runSelfCheck(o), o.delayMs ?? 120_000);
  timer.unref();
  return () => clearTimeout(timer);
}
