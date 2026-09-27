// Match Figma components to code components, with evidence and honest tiers.

import type { ComponentIndex, ExplicitLink } from "../code-model.ts";
import type { ComponentDef, Library } from "../model.ts";
import { features, prepareCode, type CodeSide, type Features, type PropPair } from "./features.ts";
import { PRIOR_MODEL, fitLogistic, score, sigmoid, type ScoringModel } from "./model.ts";
import { commonPrefix } from "./text.ts";

export type Tier = "verified" | "likely" | "possible" | "unmatched";

export interface Candidate {
  component: string;
  score: number;
  features: Features;
  props: PropPair[];
}

export interface MatchResult {
  figma: { id: string; key?: string; name: string; page: string; kind: ComponentDef["kind"]; private: boolean };
  tier: Tier;
  /** Calibrated probability that `best` is right. Absent when no calibration exists. */
  probability?: number;
  best?: Candidate;
  runnerUp?: Candidate;
  /** Why the tier is what it is, in words. */
  reason: string;
  link?: ExplicitLink;
}

/**
 * Maps a chosen match's score and its margin over the runner-up to the probability
 * that the match is right. Fitted on held-out labelled matches only.
 */
export interface Calibration {
  a: number;
  b: number;
  c: number;
  /** Probability at or above which a match is "likely" (chosen for ≥ 95% precision). */
  likely: number;
  /** Probability below which the matcher abstains. */
  possible: number;
  fittedOn: number;
}

export interface MatchOptions {
  model?: ScoringModel;
  calibration?: Calibration;
  links?: ExplicitLink[];
  /** Without calibration: minimum score, and minimum logit margin over the runner-up, to propose a match at all. */
  minScore?: number;
  minMargin?: number;
}

export interface Matcher {
  /** Score every code component against one Figma component, best first. */
  rank(def: ComponentDef): Candidate[];
}

export function createMatcher(index: ComponentIndex, model: ScoringModel = PRIOR_MODEL): Matcher {
  const prefix = commonPrefix(index.components.map((c) => c.name));
  const code: CodeSide[] = index.components.filter((c) => !c.deprecated).map((c) => prepareCode(c, prefix));
  return {
    rank(def) {
      return code
        .map((side) => {
          const ev = features(def, side);
          return { component: side.component.name, score: score(model, ev.features), features: ev.features, props: ev.props };
        })
        .sort((a, b) => b.score - a.score);
    },
  };
}

export function calibratedProbability(cal: Calibration, top: number, margin: number): number {
  return sigmoid(cal.a * logit(top) + cal.b * margin + cal.c);
}

/** Distance to the runner-up on the logit scale, where 0.999 and 0.9999 are still different. */
export function logitMargin(best: Candidate, runnerUp: Candidate | undefined): number {
  return runnerUp ? logit(best.score) - logit(runnerUp.score) : Number.POSITIVE_INFINITY;
}

function logit(p: number): number {
  const q = Math.min(1 - 1e-9, Math.max(1e-9, p));
  return Math.log(q / (1 - q));
}

/** Fit a Calibration from held-out (score, margin, correct) triples. */
export function fitCalibration(points: { score: number; margin: number; correct: boolean }[], targetPrecision = 0.95): Calibration {
  const { weights, bias } = fitLogistic(
    points.map((p) => [logit(p.score), p.margin]),
    points.map((p) => (p.correct ? 1 : 0)),
    { l2: 0.001 },
  );
  const cal: Calibration = { a: weights[0]!, b: weights[1]!, c: bias, likely: 1, possible: 0.5, fittedOn: points.length };
  // Lowest threshold whose matches at or above it reach the target precision.
  const probs = points.map((p) => ({ p: calibratedProbability(cal, p.score, p.margin), correct: p.correct })).sort((x, y) => y.p - x.p);
  let right = 0;
  probs.forEach((x, i) => {
    if (x.correct) right++;
    if (right / (i + 1) >= targetPrecision) cal.likely = Math.min(cal.likely, x.p);
  });
  return cal;
}

/** Figma node id → the library component (set) it belongs to, including variant ids. */
export function nodeOwners(library: Library): Map<string, ComponentDef> {
  const owners = new Map<string, ComponentDef>();
  for (const def of library.components) {
    owners.set(def.id, def);
    for (const v of def.variants) owners.set(v.id, def);
  }
  return owners;
}

export function matchLibrary(library: Library, index: ComponentIndex, options: MatchOptions = {}): MatchResult[] {
  const matcher = createMatcher(index, options.model);
  const owners = nodeOwners(library);
  const linked = new Map<string, ExplicitLink>();
  for (const link of options.links ?? []) {
    const def = owners.get(link.figma.nodeId);
    if (def && !linked.has(def.id)) linked.set(def.id, link);
  }
  return library.components.map((def) => decide(def, matcher.rank(def), linked.get(def.id), options));
}

export function decide(def: ComponentDef, ranked: Candidate[], link: ExplicitLink | undefined, options: MatchOptions): MatchResult {
  const figma = { id: def.id, ...(def.key && { key: def.key }), name: def.name, page: def.page, kind: def.kind, private: def.private };
  const [best, runnerUp] = ranked;
  const base = { figma, ...(best && { best }), ...(runnerUp && { runnerUp }) };

  if (link) {
    const linkedCandidate = ranked.find((c) => c.component === link.component);
    return {
      ...base,
      tier: "verified",
      ...(linkedCandidate && { best: linkedCandidate }),
      link,
      reason: `explicitly linked in ${link.source}`,
    };
  }
  if (!best) return { ...base, tier: "unmatched", reason: "no code components to compare" };

  const margin = logitMargin(best, runnerUp);
  const cal = options.calibration;
  if (cal) {
    const probability = calibratedProbability(cal, best.score, margin);
    const tier: Tier = probability >= cal.likely ? "likely" : probability >= cal.possible ? "possible" : "unmatched";
    return { ...base, tier, probability, reason: `calibrated p=${probability.toFixed(2)} (margin ${margin.toFixed(2)})` };
  }

  // Without calibration there is no measured precision, so nothing can be "likely".
  const minScore = options.minScore ?? 0.5;
  const minMargin = options.minMargin ?? 1;
  if (best.score < minScore) return { ...base, tier: "unmatched", reason: `best score ${best.score.toFixed(2)} below ${minScore}` };
  if (margin < minMargin) return { ...base, tier: "unmatched", reason: `too close to the runner-up (margin ${margin.toFixed(2)})` };
  return { ...base, tier: "possible", reason: `uncalibrated score ${best.score.toFixed(2)}, margin ${margin.toFixed(2)}` };
}
