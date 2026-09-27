# Step 0: access spike — results (2026-09-27)

Goal: prove that Tulpar can read the Figma side and that Carbon's hand-written Code Connect files can serve as an answer key for the matcher.

## Setup

- **Figma file.** Our duplicate of the Carbon community kit, "(v11) Carbon Design System (Community)".
  - File key: `b8xYgmx2Js30XaldxPkOs9`
  - Account: Figma Starter (free)
- **Token.** A personal access token, stored in the Windows user environment variable `FIGMA_TOKEN`.
  - Scopes, all read-only: `file_content`, `file_metadata`, `file_versions`, `library_assets`, `library_content`, `file_dev_resources`
  - Expires 2026-12-26.

## Results

| Check | Result |
|---|---|
| Token reads our copy | HTTP 200. 54 pages. |
| Figma file behind Carbon's Code Connect links | `YAnB1jKx0yCUL29j6uSLpg` "(v11) All themes – Carbon Design System". It is private to IBM: HTTP 404 for us. |
| Carbon Code Connect files | 162 files (89 React, 73 Web Components), containing 299 links to 103 unique node ids |
| Those node ids in **our copy** | **103 of 103 resolve.** Duplicating a Figma file preserves node ids, so the answer key works directly and no name join is needed. |
| Node types | 291 links point to a `COMPONENT_SET`, 8 to a `COMPONENT` |
| Names agree (loose check) | 292 of 299 |
| API budget used | 4 requests |

## Hard cases: code name and Figma name disagree

Name similarity alone cannot find these; the matcher must use props, variants and structure.

| Code component | Figma name |
|---|---|
| `SideNav` / `side-nav` | UI shell - Left panel |
| `HeaderPanel` / `header-panel` | UI shell - Right panel |
| `TreeNode` | Branch node item |
| `Grid` | Screen |
| `IconSwitch` | _Content switcher icon item |

## Conclusion

The plan's biggest unknown is resolved. We can measure matching precision and recall against Carbon's real mappings, on a free Figma account.

Next: step 1, the design model.
