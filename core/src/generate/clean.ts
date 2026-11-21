// Production code without Tulpar's markers. The data-figma-id attributes let the verifier measure each element
// against its Figma layer; once the code is verified, a team may not want them in what it ships. This removes them
// from the component's files, and refuses (saying why) when the component's own tests find elements by them, so a
// clean copy never breaks its tests. Web markup only: Flutter's, Compose's and Vaadin's equivalents are part of
// how their tests and the verifier find elements, and stay.

export interface CleanResult {
  files: { path: string; content: string }[];
  /** How many markers were removed. */
  removed: number;
  /** Why nothing was removed, when nothing was. */
  kept?: string;
}

const TEST = /[._-](test|spec)\.|Tests?\.(cs|java|kt)$|_test\.(dart|rs)$/i;
// data-figma-id="…", '…' or {…} (JSX), and Angular's [attr.data-figma-id]="…", with the space before it.
const MARKER = /\s+(?:\[attr\.)?data-figma-id\]?=(?:"[^"]*"|'[^']*'|\{[^{}]*\})/g;

export function stripFigmaIds(files: { path: string; content: string }[]): CleanResult {
  if (files.some((f) => TEST.test(f.path) && f.content.includes("data-figma-id"))) {
    return { files, removed: 0, kept: "its tests find elements by data-figma-id, so the markers stay" };
  }
  let removed = 0;
  const out = files.map((f) => {
    if (TEST.test(f.path)) return f;
    const content = f.content.replace(MARKER, () => {
      removed++;
      return "";
    });
    return content === f.content ? f : { ...f, content };
  });
  return removed ? { files: out, removed } : { files, removed: 0, kept: "no data-figma-id markers in its markup" };
}
