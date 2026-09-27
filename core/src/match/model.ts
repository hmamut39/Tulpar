// Logistic regression over pair signals. Each signal contributes its value and a
// separate "missing" indicator, so a missing signal is learned, not read as zero.
// Small by design: a few hundred labels will not support more (plan §2).

import { FEATURES, type Features } from "./features.ts";

export interface ScoringModel {
  /** "prior": hand-set weights, not fitted to labels. Probabilities are then uncalibrated. */
  kind: "prior" | "fitted";
  bias: number;
  weights: Record<string, number>;
  /** Labels the model was fitted on, for the report. */
  trainedOn?: { positives: number; negatives: number };
}

/** Hand-set starting weights. Scores from these are rankings, not probabilities. */
export const PRIOR_MODEL: ScoringModel = {
  kind: "prior",
  bias: -7,
  weights: {
    docLink: 5,
    description: 2,
    props: 4,
    values: 3,
    name: 4,
    head: 2,
    nameContained: 3,
    page: 2,
  },
};

/** Feature vector: [value or 0, missing flag] per signal. */
export function vectorize(f: Features): { names: string[]; values: number[] } {
  const names: string[] = [];
  const values: number[] = [];
  for (const k of FEATURES) {
    names.push(k, `${k}:missing`);
    values.push(f[k] ?? 0, f[k] === null ? 1 : 0);
  }
  return { names, values };
}

export function score(model: ScoringModel, f: Features): number {
  const { names, values } = vectorize(f);
  let z = model.bias;
  names.forEach((n, i) => (z += (model.weights[n] ?? 0) * values[i]!));
  return sigmoid(z);
}

/**
 * Fit pair weights by logistic regression. Positive and negative examples are
 * weighted to balance, because each Figma component has one right answer among
 * hundreds of wrong ones. The resulting scores rank candidates; they are not the
 * probability that a chosen match is right. That is calibrated separately (match.ts).
 */
export function fit(examples: { features: Features; label: 0 | 1 }[], options: LogisticOptions = {}): ScoringModel {
  const names = vectorize(examples[0]!.features).names;
  const pos = examples.filter((e) => e.label === 1).length;
  const neg = examples.length - pos;
  if (!pos || !neg) throw new Error(`Cannot fit: ${pos} positive and ${neg} negative examples.`);
  const { weights, bias } = fitLogistic(
    examples.map((e) => vectorize(e.features).values),
    examples.map((e) => e.label),
    { ...options, balance: true },
  );
  return { kind: "fitted", bias, weights: Object.fromEntries(names.map((n, j) => [n, weights[j]!])), trainedOn: { positives: pos, negatives: neg } };
}

export interface LogisticOptions {
  l2?: number;
  iterations?: number;
  rate?: number;
  /** Weight classes to balance. */
  balance?: boolean;
}

/** Full-batch gradient descent with L2 regularisation (not applied to the bias). */
export function fitLogistic(rows: number[][], labels: (0 | 1)[], options: LogisticOptions = {}): { weights: number[]; bias: number } {
  const { l2 = 0.01, iterations = 3000, rate = 0.5, balance = false } = options;
  const n = rows.length;
  const pos = labels.filter((l) => l === 1).length;
  const sampleWeight = labels.map((l) => (!balance ? 1 : l === 1 ? n / (2 * pos) : n / (2 * (n - pos))));
  const dims = rows[0]?.length ?? 0;
  const w = new Array<number>(dims).fill(0);
  let b = 0;
  for (let it = 0; it < iterations; it++) {
    const gw = new Array<number>(dims).fill(0);
    let gb = 0;
    rows.forEach((x, i) => {
      let z = b;
      for (let j = 0; j < dims; j++) z += w[j]! * x[j]!;
      const err = (sigmoid(z) - labels[i]!) * sampleWeight[i]!;
      for (let j = 0; j < dims; j++) gw[j]! += err * x[j]!;
      gb += err;
    });
    for (let j = 0; j < dims; j++) w[j]! -= rate * (gw[j]! / n + l2 * w[j]!);
    b -= (rate * gb) / n;
  }
  return { weights: w, bias: b };
}

export function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-z));
}
