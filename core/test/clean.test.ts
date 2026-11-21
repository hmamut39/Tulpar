// Production code without Tulpar's markers, never at the cost of the component's own tests.

import { describe, expect, it } from "vitest";
import { stripFigmaIds } from "../src/index.ts";

describe("removing the Figma ids", () => {
  it("removes data-figma-id from markup in each syntax, and leaves the tests and everything else", () => {
    const r = stripFigmaIds([
      { path: "Card.tsx", content: '<section className="card" data-figma-id="1:1">\n  <h2 data-figma-id={"1:2"}>{title}</h2>\n</section>' },
      { path: "card.component.html", content: "<p class=\"body\" data-figma-id='1:3'>{{ summary() }}</p>\n<img [attr.data-figma-id]=\"'1:4'\" alt=\"\" />" },
      { path: "Card.css", content: ".card { gap: var(--x, 8px); }" },
      { path: "Card.test.tsx", content: 'expect(screen.getByRole("heading")).toBeTruthy();' },
    ]);
    expect(r.removed).toBe(4);
    expect(r.files[0]!.content).toBe('<section className="card">\n  <h2>{title}</h2>\n</section>');
    expect(r.files[1]!.content).toBe('<p class="body">{{ summary() }}</p>\n<img alt="" />');
    expect(r.files[2]!.content).toBe(".card { gap: var(--x, 8px); }");
  });

  it("keeps them when the component's tests find elements by them", () => {
    const files = [
      { path: "Card.tsx", content: '<h2 data-figma-id="1:2">{title}</h2>' },
      { path: "Card.test.tsx", content: 'container.querySelector("[data-figma-id=\'1:2\']")' },
    ];
    expect(stripFigmaIds(files)).toEqual({ files, removed: 0, kept: "its tests find elements by data-figma-id, so the markers stay" });
  });
});
