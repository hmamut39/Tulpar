// Reusable: the design's content written in place fails, the same content as an input's default passes.

import { describe, expect, it } from "vitest";
import { contentTexts, hardCodedContent } from "../src/verify/reusable.ts";
import type { DesignNode } from "../src/index.ts";

const base = { visible: true, opacity: 1, fills: [], effects: [], clips: false, tokens: {} };
const text = (id: string, characters: string) => ({ ...base, id, name: characters, kind: "text", characters, style: {} }) as unknown as DesignNode;
const button = { ...base, id: "9:1", name: "Button", kind: "instance", component: { id: "B" }, props: [], children: [text("9:2", "Add to cart")] } as unknown as DesignNode;
const card = { ...base, id: "1:1", name: "Card", kind: "container", figmaType: "FRAME", children: [text("1:2", "Heirloom tomato"), text("1:3", "$5.99 / lb"), text("1:4", "Fresh"), button] } as unknown as DesignNode;

const found = (path: string, content: string) => hardCodedContent(card, [{ path, content }]).map((h) => `${h.text} @${h.line}`);

describe("reusable", () => {
  it("takes the frame's own text of two words or with a digit, not design-system labels or single words", () => {
    expect(contentTexts(card).map((t) => t.text)).toEqual(["Heirloom tomato", "$5.99 / lb"]);
  });

  it("finds content written in place, in each framework", () => {
    expect(found("Card.tsx", 'export default function Card() {\n  return (\n    <article>\n      <h2>Heirloom tomato</h2>\n      <p>{"$5.99 / lb"}</p>\n    </article>\n  );\n}')).toEqual(["Heirloom tomato @4", "$5.99 / lb @5"]);
    expect(found("card.component.html", '<article>\n  <h2>\n    Heirloom tomato\n  </h2>\n</article>')).toEqual(["Heirloom tomato @3"]);
    expect(found("Card.vue", "<template>\n  <h2>Heirloom   tomato</h2>\n</template>")).toEqual(["Heirloom tomato @2"]);
    expect(found("product_card.dart", "Text('Heirloom tomato', style: t.titleLarge)")).toEqual(["Heirloom tomato @1"]);
    expect(found("ProductCard.java", 'H2 name = new H2("Heirloom tomato");')).toEqual(["Heirloom tomato @1"]);
    expect(found("product_card.rs", 'view! { <h2>"Heirloom tomato"</h2> }')).toEqual(["Heirloom tomato @1"]);
    expect(found("ProductCard.kt", 'Text("$5.99 / lb", style = MaterialTheme.typography.bodyLarge)')).toEqual(["$5.99 / lb @1"]);
  });

  it("passes content taken as inputs with the design's values as defaults", () => {
    expect(found("Card.tsx", 'export default function Card({ productName = "Heirloom tomato", price = "$5.99 / lb" }: CardProps) {\n  return <article><h2>{productName}</h2><p>{price}</p></article>;\n}')).toEqual([]);
    expect(found("card.component.ts", 'readonly productName = input("Heirloom tomato");\nreadonly price = input("$5.99 / lb");')).toEqual([]);
    expect(found("Card.vue", '<script setup lang="ts">\nwithDefaults(defineProps<{ productName?: string }>(), { productName: "Heirloom tomato" });\n</script>\n<template><h2>{{ productName }}</h2></template>')).toEqual([]);
    expect(found("product_card.dart", "const ProductCard({super.key, this.productName = 'Heirloom tomato'});\nText(productName)")).toEqual([]);
    expect(found("ProductCard.kt", 'fun ProductCard(productName: String = "Heirloom tomato") { Text(productName) }')).toEqual([]);
  });

  it("never reads the tests: they may name the content they expect", () => {
    expect(hardCodedContent(card, [{ path: "Card.test.tsx", content: "expect(screen.getByText(\"Heirloom tomato\")).toBeTruthy(); render(<h2>Heirloom tomato</h2>)" }])).toEqual([]);
  });
});
