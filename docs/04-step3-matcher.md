# Step 3: matcher — built, not yet scored (2026-09-27)

Goal: match Figma components to code components when their names disagree, show the evidence, and measure precision against Carbon's hand-written Code Connect mappings, with those mappings hidden from the matcher. **Gate: the "Likely" tier reaches ≥ 95% precision.**

**Status:** the matcher, the answer-key reader and the evaluation are built and tested. The gate **cannot be measured yet.** Only 12 of Carbon's 93 labelled Figma components sit on the 14 Figma pages we could download before the free plan's monthly API budget ran out ([docs/02](02-step1-design-model.md)). Twelve labels cannot support a precision claim, and the tool refuses to make one.

## What was built

- **Answer key** ([adapters/web-components/src/links.ts](../adapters/web-components/src/links.ts)): a new `links` method in the adapter protocol. It reads Code Connect files in both formats found in Carbon:
  - template files, via their `// url=` and `// component=` header;
  - `figma.connect(url, { variant, example })` calls, located with the TypeScript parser.

  Result: **142 links from all 73** web-components files, pointing at 93 distinct Figma nodes.
  - Carbon's links point at IBM's private Figma file. Our duplicate keeps the same node ids (step 0), so links are matched by node id.
  - Links to a variant's node are attributed to its component set.
- **Signals** ([core/src/match/features.ts](../core/src/match/features.ts)). Each is scored in [0, 1], or `null` when it cannot apply, so a missing description never counts against a match:

  | Signal | What it measures |
  |---|---|
  | `docLink` | Figma documentation links that name the component |
  | `description` | the Figma description names the component |
  | `props` | Figma properties aligned to code props and slots, by name, type and values. Examples: `State=Disabled` → boolean `disabled`; `Button text` → the default slot; instance-swap → a slot |
  | `values` | variant values covered by the code's enums, after normalising size words (`Extra large` → `xl`) |
  | `name` | overlap of the name words, without kit filler words ("item", "base", "default") |
  | `head` | the word that says what the component is: the last word of the name, before any " - Flavor" part |
  | `nameContained` | the code name's words all appear in the Figma name or page |
  | `page` | the Figma page's name |

- **Scoring** ([core/src/match/model.ts](../core/src/match/model.ts)):
  - logistic regression over the signals, with a separate "missing" input for each;
  - hand-set prior weights until it is fitted on labels;
  - class-balanced fitting on each labelled component's 20 hardest wrong candidates.
- **Decisions and tiers** ([core/src/match/match.ts](../core/src/match/match.ts)):
  - **Verified:** an explicit link exists (outside evaluation).
  - **Likely / Possible / Unmatched:** from a calibrated probability, which comes from the chosen match's score and its logit margin over the runner-up.
  - **Without calibration, nothing can be "likely".** A match is proposed as "possible (uncalibrated)" only when its score is at least 0.5 and its logit margin at least 1; otherwise the matcher abstains and says why.
- **Evaluation** ([core/src/match/evaluate.ts](../core/src/match/evaluate.ts)): run with `tulpar match examples/carbon --evaluate`.
  - Labels are hidden from the matcher.
  - Two modes: prior weights, and leave-one-out (fit on every other label, predict the held-out one).
  - Reports top-1 and top-3 accuracy, precision per tier, recall, abstention rate and, once there are ≥ 30 labels, calibration with its error (ECE).
  - Labels that could not be used are counted, with the reason.

**Deviation from the plan:** each Figma component takes its best candidate independently, instead of a Hungarian assignment. Carbon maps several Figma components to one element (both "Tag - Read-only" and "Tag - Selectable" can map to `cds-tag`), so a one-to-one assignment would force errors.

## Development-set results (not a measurement)

| | Prior weights | Leave-one-out |
|---|---|---|
| Labelled components scored | 12 | 12 |
| Right answer ranked first | 92% | 92% |
| Right answer in the top 3 | 100% | 100% |
| Proposed ("possible"), and correct | 10 of 10 | 7 of 7 |
| Abstained | 2 | 5 |

**Why these numbers are not evidence yet:**
- There are only 12 labels.
- I changed the matcher after reading its errors on these same 12. The changes:
  - keep the page name out of the name signal (it made a page's parent component look like a name match for every part);
  - drop kit filler words;
  - add the head-word signal;
  - measure margins on the logit scale (scores saturated near 1, so every margin looked tiny).

  These are general rules, not Carbon-specific ones, but they were prompted by these labels.
- The 12 ids are therefore recorded as the **development set** in [examples/carbon/tulpar.json](../examples/carbon/tulpar.json). Every evaluation reports held-out labels separately; right now there are none.

**Known limit, pinned by a test:** with prior weights, a parent component that shares a part's props can outvote the head word. "Data table toolbar item" has `Size` values that `cds-table` shares and `cds-table-toolbar` lacks. The fitted leave-one-out model ranks the toolbar first.

## Unlabelled matches (the normal, non-evaluation run)

`tulpar match examples/carbon` on the 50 cached components:

| Tier | Count | Notes |
|---|---|---|
| Verified | 12 | via Code Connect |
| Possible (uncalibrated) | 15 | e.g. Badge indicator → `cds-badge-indicator`, Status shape → `cds-shape-indicator` |
| Unmatched | 23 | mostly utilities with no code counterpart (Spacer, Gradient, Cursor, Aspect ratio), plus close calls it declined |

At least one "possible" is doubtful: Screen → `cds-interstitial-screen`. Step 0 recorded Screen ↔ `Grid` as a hard case. This is why nothing is "likely" before calibration.

## October runbook: the scored run

Once the Figma budget resets:

```sh
# Fetch the 40 missing pages. The per-node cache asks only for missing pages; batches of 10 means 4 requests.
npm run tulpar -- library b8xYgmx2Js30XaldxPkOs9 --batch 10
# Score. Held-out labels (all except the 12 development ids) are the measurement.
npm run tulpar -- match examples/carbon --evaluate
```

- Expect about 90 labelled components, with about 78 held out. That is enough for leave-one-out calibration (at least 30 needed).
- The calibration and the Likely threshold are fitted on the same held-out outcomes they are scored on, so they are optimistic; the report says so.
- The clean test comes in step 5: fit on Carbon Web Components, then score the untouched **React** labels (89 files) against the same Figma file.

## Next

- **Step 4, the verifier:** build, render and compare against the Figma frame. It needs no new Figma calls for the frames we already have, except rendering Figma images, which uses the same budget. It can start now.
- **Step 3's scored run:** in October, per the runbook above.
