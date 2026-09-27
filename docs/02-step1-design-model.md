# Step 1: design model — results (2026-09-27)

Goal: turn Figma into Tulpar's own framework-free design model, and prove that nothing is lost on the way.

## What was built

- **TypeScript monorepo** (npm workspaces, Node 24 runs `.ts` directly, no build step): `core/` and `cli/`. The adapters arrive in step 2.
- **Design model** ([core/src/model.ts](../core/src/model.ts)), in design terms only:
  - four node kinds: `container`, `instance`, `text`, `shape`;
  - boxes relative to the root, in design points, plus render bounds that include shadows;
  - auto layout as a `Stack` (axis, gap, padding, alignment, wrap), and each child's sizing (fixed, hug, fill);
  - paints with an explicit colour space, strokes, radii and effects;
  - a token reference on every value that is bound to a Figma variable or style;
  - instances resolved to their component and component set, with clean property names;
  - text with its characters, style and per-range overrides.
  - Anything the model cannot express goes into `unsupported` on the node, so it is never dropped silently.
- **Library** extraction: component sets with their properties, variant values, default size, description and documentation links, plus the file's styles.
- **Figma client** ([core/src/figma/client.ts](../core/src/figma/client.ts)):
  - caches each node separately on disk, so later fetches request only what is missing;
  - has an offline mode;
  - stops cleanly when the API budget is spent (see below).
- **CLI**: `tulpar model <fileKey> <nodeId>...` and `tulpar library <fileKey>`, each followed by a round-trip check.

## Round-trip results

The check rebuilds each node's absolute Figma box from the model. It also compares ids, child counts, node kinds, text and instance → component links.

| Subject | Node | Nodes | Boxes exact | Max error |
|---|---|---|---|---|
| Tile, expandable | `20125:279602` | 51 | 51 | 0 |
| Form on page, 2 columns | `3897:51337` | 703 | 703 | 0 |
| Modal, large | `49013:14988` | 247 | 247 | 0 |
| Data table, default | `4633:367774` | 3,966 | 3,966 | 0 |
| Every component on the 14 cached pages | 50 trees | 51,431 | 51,431 | 0 |

The **mutation tests** ([core/test/design-model.test.ts](../core/test/design-model.test.ts)) prove the check can fail. It catches:
- a box shifted by 0.01 pt;
- a resized box, a moved origin, or a lost render box;
- a dropped child;
- changed text;
- a swapped component, or a changed id;
- a text node turned into a container;
- a box invented for a node that has none.

**Not expressed by the model yet:**
- `blendMode` MULTIPLY (×26) and DARKEN (×4) are recorded as unsupported.
- Figma's GRID auto layout has no `Stack` equivalent yet. It did not appear in the cached pages.

## What the data shows

- In the four subjects, **99% of solid paints are bound to a Carbon variable** (3,055 of 3,076). The token-vs-hard-coded check in step 4 therefore has a real signal on the Figma side.
- Every instance resolves to a named component. For example, the large Modal uses 19 different component sets.

## Blocker found: the free plan's API budget

After about 11 heavy-endpoint (Tier 1) calls this month, Figma answered HTTP 429:
- `X-Figma-Rate-Limit-Type: low`
- `Retry-After: 398709` seconds, which is about 4.6 days and lands at the start of October.

On the Starter plan this is a **small monthly budget** for the file, nodes and images endpoints, not a per-minute limit.

- **Cached so far:** 14 of 54 pages (Button, Data table, Tile, Modal, Form, Tag, the foundation pages, and 3 others).
- **Not cached:** 40 pages, including Accordion, Checkbox, Dropdown, Tabs, Text input and UI shell. `tulpar library` reports them as *not checked* and exits with failure, because a partial library is not a success.
- **Next month:** the per-node cache lets us fetch all 40 remaining pages in one or two requests.

**What this means for the product** (to fold into the plan's risks):
1. Teams on Figma's free plan cannot use the REST API in any practical way. The images endpoint (needed for visual diffs) is in the same budget.
2. Paid seats (Professional with a Dev or Full seat, and above) get per-minute limits instead. The companies we target, which use Figma for every release, are on Organization or Enterprise.
3. For free-plan users, a **companion Figma plugin** that exports the file has no REST budget at all. The plan already proposes a plugin for variables, so it should also export the design tree.

## Next

- **Step 2: component index + tokens (web-components adapter).** This needs no Figma calls. It reads `custom-elements.json` from `@carbon/web-components` and the tokens from Carbon's theme package. It can start now.
- **Step 3: matcher, scored.** This needs the component sets the 103 answer-key node ids point to, and most of them sit on uncached pages. It waits for the budget reset (October) or a paid seat.
