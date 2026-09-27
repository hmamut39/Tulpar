# Step 6: drift — results (2026-09-27)

Goal: replay real releases of the design system, detect what changed (props added, removed or renamed; types, values and defaults changed), and report each change that touches a confirmed mapping as a **finding for a human**. A confirmed mapping is never re-matched silently.

Run it with:

```sh
npm run tulpar -- drift examples/carbon --from 2.63.0 --to 2.64.0
npm run tulpar -- drift examples/carbon-react --from 1.100.0 --to 1.117.0
```

## What was built

- **Core** ([core/src/drift/drift.ts](../core/src/drift/drift.ts)), framework-free:
  - `signature()`: a stable hash of what a component offers (design-facing props with type and default, slots, events, deprecation). Unchanged signatures are skipped.
  - `compareIndexes()`: compares two readings of a library.
    - **Components:** removed, added, deprecated, or **renamed**. A rename is detected by the same source file or export, or by near-identical props.
    - **Props:** removed, added, **renamed** (same type, similar name or a shared alias), type changed, enum values added or removed, open/closed enum changed, default changed, deprecated.
    - **Slots and events:** added or removed.
  - **Severity:**
    - **breaks-mapping:** a confirmed component was removed or renamed, or a prop or slot that a Figma property is *aligned to* was removed or renamed;
    - **affects-mapping:** any other change on a confirmed component;
    - **info:** changes on components with no confirmed mapping.
  - Each finding names the Figma components involved, and the Figma properties aligned to the changed prop (from the matcher's prop alignment).
- **CLI** ([cli/src/drift.ts](../cli/src/drift.ts)):
  - It fetches each release from npm once (`npm pack`), unpacks it inside the project (so its type imports resolve), and reads it with the project's own adapter over the protocol.
  - Confirmed mappings come from the explicit links (Code Connect).
  - Exit code 1 when anything breaks a mapping, so CI can gate on it.
- **The core didn't change for React.** The same command replays Carbon React releases.

## Results

| Replay | Components | Changed | Breaks a mapping | Affects a mapping | Informational |
|---|---|---|---|---|---|
| Carbon WC 2.63.0 → 2.64.0 (2 weeks) | 255 → 290 | 1 | 0 | 0 | 35 |
| Carbon WC 2.39.0 → 2.64.0 (1 year) | 185 → 290 | 62 | 0 | 11 | 326 |
| Carbon React 1.100.0 → 1.117.0 | 255 → 256 | 33 | 0 | 2 | 51 |

**Findings worth a human's attention** (from the one-year replay):
- **`cds-button` `size`: string → 6 values (open).** The report ties it to the Figma property aligned to it: `Button › Size`. The code's typing caught up with the design.
- **`cds-modal` gained `loadingStatus`, `loadingDescription`, `loadingSuccessDelay` and more.** The Figma kit's modal footer has an "Inline loading" variant, so this is a new capability the mapping should use. A human decides; nothing re-matches on its own.
- **4 props were removed and 6 components deprecated,** all unmapped. Code using them breaks.

**And from the two-week replay:**
- 2.64.0 adds 35 tags: preview form controls, plus `cds-interstitial-screen`, `cds-guide-banner` and others.
- One of them is **`test-subclassed-input`, a test fixture published in Carbon's manifest.** A drift report is where that kind of release accident surfaces.

**React:** `Grid` gained `withRowGap` (confirmed for Figma "Screen"); `ModalFooter` gained `dangerDescription`.

## Limits (stated, not hidden)

- **Confirmed mappings are only those whose Figma nodes are on the 14 cached pages:** 14 web-components and 15 React components. In October the full library makes the rest confirmable.
- **A finding's aligned Figma properties are only as good as the matcher's prop alignment.** One example is doubtful: `cds-modal`'s `ariaLabel` default change is tied to `Modal › Label text`.
- **Both releases are read with the project's *current* dependencies** (e.g. its lit or @types/react), not the ones each release was built with. The report lists this caveat.
- **Figma-side drift isn't replayed yet.** It needs older versions of the Figma file, and the versions endpoint shares the API budget. The same `compareIndexes` logic applies once the library is read at two versions.
- **Renames are inferred.** Code doesn't declare "renamed", so a rename can also be reported as a remove plus an add. The report never guesses silently: every rename it detects is stated as a rename, with both names.

## Tests

124 pass. New in this step: the drift rules on synthetic libraries:
- unchanged releases;
- a removed aligned prop breaking the mapping;
- prop renames and enum changes;
- component rename by source file;
- removal of a mapped component;
- type, default, deprecation, slot and event changes, with internal props ignored.
