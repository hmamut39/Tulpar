// The order card: a design we wrote ourselves, as Figma's own REST JSON, so it lives in the public repository and
// needs no Figma access. The golden gate (cli/test/golden) verifies hand-written references against it; the
// server's weekly drift check (web/src/canary.ts) generates it with the real model to see the model has not slipped.

/** The design system's own scale: each project's card is drawn in sizes its tokens have. */
export interface Scale {
  font: string;
  title: [size: number, lineHeight: number];
  body: [size: number, lineHeight: number];
  padding: number;
  gap: number;
  /** The title's and the body's weights (default 400 and 400). */
  weights?: [title: number, body: number];
  /** The title's and the body's colours, as Figma's 0–1 RGB (default greys 0.09 and 0.32). */
  colors?: [title: [number, number, number], body: [number, number, number]];
  /** The card's fill (default white): Material 3's surface is not white. */
  background?: [number, number, number];
}

/** The order card as Figma's REST JSON: a vertical auto layout, 320 wide, a title and a summary line. */
export function orderCard(s: Scale) {
  const inner = 320 - 2 * s.padding;
  const titleY = s.padding;
  const bodyY = titleY + s.title[1] + s.gap;
  const [titleWeight, bodyWeight] = s.weights ?? [400, 400];
  const [titleColor, bodyColor] = s.colors ?? [[0.09, 0.09, 0.09], [0.32, 0.32, 0.32]];
  const text = (id: string, name: string, characters: string, y: number, [size, line]: [number, number], [r, g, b]: [number, number, number], weight: number) => ({
    id,
    name,
    type: "TEXT",
    absoluteBoundingBox: { x: s.padding, y, width: inner, height: line },
    characters,
    style: { fontFamily: s.font, fontWeight: weight, fontSize: size, lineHeightPx: line, textAlignHorizontal: "LEFT", textAlignVertical: "TOP" },
    fills: [{ type: "SOLID", color: { r, g, b, a: 1 } }],
    layoutSizingHorizontal: "FILL",
    layoutSizingVertical: "HUG",
  });
  return {
    document: {
      id: "900:1",
      name: "Order card",
      type: "FRAME",
      absoluteBoundingBox: { x: 0, y: 0, width: 320, height: bodyY + s.body[1] + s.padding },
      fills: [{ type: "SOLID", color: { r: s.background?.[0] ?? 1, g: s.background?.[1] ?? 1, b: s.background?.[2] ?? 1, a: 1 } }],
      layoutMode: "VERTICAL",
      itemSpacing: s.gap,
      paddingTop: s.padding,
      paddingRight: s.padding,
      paddingBottom: s.padding,
      paddingLeft: s.padding,
      primaryAxisAlignItems: "MIN",
      counterAxisAlignItems: "MIN",
      children: [text("900:2", "Title", "Order summary", titleY, s.title, titleColor, titleWeight), text("900:3", "Body", "Two items, ready to ship.", bodyY, s.body, bodyColor, bodyWeight)],
    },
    components: {},
    componentSets: {},
    styles: {},
  };
}
