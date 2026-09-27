// Score the matcher against known mappings, with those mappings hidden from it.

import type { ComponentIndex, ExplicitLink } from "../code-model.ts";
import type { ComponentDef, Library } from "../model.ts";
import type { Features } from "./features.ts";
import { createMatcher, decide, fitCalibration, logitMargin, nodeOwners, type Calibration, type Candidate, type Tier } from "./match.ts";
import { PRIOR_MODEL, fit, type ScoringModel } from "./model.ts";

/** Below this many labelled components, calibration and tier precision are not reported as measured. */
export const MIN_LABELS_FOR_CALIBRATION = 30;
const HARD_NEGATIVES = 20;

export interface Evaluation {
  mode: "prior" | "leave-one-out";
  /** "all" labels, or only those "held-out" from development. */
  subset: "all" | "held-out";
  /** Figma components in the library that have a label whose code component is in the index. */
  labelled: number;
  /** Labels that could not be used, with the reason. */
  unusable: Record<string, number>;
  top1: number;
  top3: number;
  tiers: Record<Tier, { count: number; correct: number }>;
  /** Share of labelled components given a proposed match (likely or possible) that is correct. */
  recall: number;
  abstained: number;
  calibration?: Calibration;
  /** Expected calibration error of calibrated probabilities (10 bins). */
  ece?: number;
  notes: string[];
  errors: { figma: string; expected: string[]; got?: string; tier: Tier; score?: number }[];
}

export interface LabelledDef {
  def: ComponentDef;
  answers: Set<string>;
}

/** Group links by the library component they point at, keeping only usable ones. */
export function labelled(library: Library, index: ComponentIndex, links: ExplicitLink[]): { items: LabelledDef[]; unusable: Record<string, number> } {
  const owners = nodeOwners(library);
  const known = new Set(index.components.filter((c) => !c.deprecated).map((c) => c.name));
  const byDef = new Map<string, LabelledDef>();
  const unusable: Record<string, number> = {};
  const skip = (why: string) => (unusable[why] = (unusable[why] ?? 0) + 1);
  for (const link of links) {
    const def = owners.get(link.figma.nodeId);
    if (!def) {
      skip("Figma node not in the library read so far");
      continue;
    }
    if (!known.has(link.component)) {
      skip("code component not in the index (or deprecated)");
      continue;
    }
    const item = byDef.get(def.id) ?? { def, answers: new Set<string>() };
    item.answers.add(link.component);
    byDef.set(def.id, item);
  }
  return { items: [...byDef.values()], unusable };
}

export interface EvaluateOptions {
  /**
   * Figma component ids to score. Others still train the leave-one-out models.
   * Used to report labels never looked at during development separately.
   */
  scoreOnly?: Set<string>;
}

export function evaluate(library: Library, index: ComponentIndex, links: ExplicitLink[], mode: Evaluation["mode"], options: EvaluateOptions = {}): Evaluation {
  const { items, unusable } = labelled(library, index, links);
  const scored = options.scoreOnly ? items.filter((it) => options.scoreOnly!.has(it.def.id)) : items;
  const notes: string[] = [];
  const prior = createMatcher(index, PRIOR_MODEL);
  const rankings = new Map(items.map((it) => [it.def.id, prior.rank(it.def)]));

  let ranked: { item: LabelledDef; ranking: Candidate[] }[];
  if (mode === "prior") {
    ranked = scored.map((item) => ({ item, ranking: rankings.get(item.def.id)! }));
    notes.push("Scores come from hand-set prior weights, not fitted to labels.");
  } else {
    if (items.length < 3) throw new Error(`Leave-one-out needs at least 3 labelled components; have ${items.length}.`);
    ranked = scored.map((item) => {
      const model = fit(trainingExamples(items.filter((o) => o !== item), rankings));
      return { item, ranking: createMatcher(index, model).rank(item.def) };
    });
    notes.push(`Each prediction comes from a model fitted on the other ${items.length - 1} labelled components.`);
  }

  // Calibration only when there are enough held-out outcomes to mean something.
  let calibration: Calibration | undefined;
  const outcomes = ranked.map(({ item, ranking }) => ({
    score: ranking[0]?.score ?? 0,
    margin: ranking[0] ? Math.min(20, logitMargin(ranking[0], ranking[1])) : 0,
    correct: !!ranking[0] && item.answers.has(ranking[0].component),
  }));
  if (mode === "leave-one-out" && scored.length >= MIN_LABELS_FOR_CALIBRATION) {
    calibration = fitCalibration(outcomes);
    notes.push("Calibration and the Likely threshold are fitted on the same held-out outcomes they are scored on; expect them to be optimistic until a separate test set exists.");
  } else {
    notes.push(`Not calibrated: ${scored.length} scored labelled components (need ${MIN_LABELS_FOR_CALIBRATION}). No match can be "likely", and no precision figure is a measured guarantee.`);
  }

  const tiers: Evaluation["tiers"] = { verified: { count: 0, correct: 0 }, likely: { count: 0, correct: 0 }, possible: { count: 0, correct: 0 }, unmatched: { count: 0, correct: 0 } };
  const errors: Evaluation["errors"] = [];
  let top1 = 0;
  let top3 = 0;
  const probs: { p: number; correct: boolean }[] = [];
  for (const { item, ranking } of ranked) {
    const result = decide(item.def, ranking, undefined, calibration ? { calibration } : {});
    const correct = !!result.best && item.answers.has(result.best.component);
    if (ranking[0] && item.answers.has(ranking[0].component)) top1++;
    if (ranking.slice(0, 3).some((c) => item.answers.has(c.component))) top3++;
    tiers[result.tier].count++;
    if (correct) tiers[result.tier].correct++;
    if (result.probability !== undefined) probs.push({ p: result.probability, correct });
    if (!correct || result.tier === "unmatched") {
      errors.push({ figma: `${item.def.name} (${item.def.id})`, expected: [...item.answers], ...(result.best && { got: result.best.component, score: round(result.best.score) }), tier: result.tier });
    }
  }
  const proposed = tiers.likely.count + tiers.possible.count;
  return {
    mode,
    subset: options.scoreOnly ? "held-out" : "all",
    labelled: scored.length,
    unusable,
    top1: scored.length ? top1 / scored.length : 0,
    top3: scored.length ? top3 / scored.length : 0,
    tiers,
    recall: scored.length ? (tiers.likely.correct + tiers.possible.correct) / scored.length : 0,
    abstained: scored.length ? tiers.unmatched.count / scored.length : 0,
    ...(calibration && { calibration, ece: ece(probs) }),
    notes,
    errors,
  };
}

/** Each labelled component's right answers, and its hardest wrong candidates under the prior. */
function trainingExamples(items: LabelledDef[], rankings: Map<string, Candidate[]>): { features: Features; label: 0 | 1 }[] {
  const out: { features: Features; label: 0 | 1 }[] = [];
  for (const item of items) {
    const ranking = rankings.get(item.def.id)!;
    for (const c of ranking.filter((c) => item.answers.has(c.component))) out.push({ features: c.features, label: 1 });
    for (const c of ranking.filter((c) => !item.answers.has(c.component)).slice(0, HARD_NEGATIVES)) out.push({ features: c.features, label: 0 });
  }
  return out;
}

function ece(points: { p: number; correct: boolean }[], bins = 10): number {
  if (!points.length) return 0;
  let total = 0;
  for (let b = 0; b < bins; b++) {
    const inBin = points.filter((x) => Math.min(bins - 1, Math.floor(x.p * bins)) === b);
    if (!inBin.length) continue;
    const conf = inBin.reduce((s, x) => s + x.p, 0) / inBin.length;
    const acc = inBin.filter((x) => x.correct).length / inBin.length;
    total += (inBin.length / points.length) * Math.abs(conf - acc);
  }
  return total;
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export type { ScoringModel };
