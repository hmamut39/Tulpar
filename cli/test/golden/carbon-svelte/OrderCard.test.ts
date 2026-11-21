import { flushSync, mount } from "svelte";
import { describe, expect, it } from "vitest";
import OrderCard from "./OrderCard.svelte";

function show(props: Record<string, string> = {}): HTMLElement {
  const target = document.createElement("div");
  document.body.appendChild(target);
  mount(OrderCard, { target, props });
  flushSync();
  return target;
}

describe("OrderCard", () => {
  it("shows the design's title and summary by default", () => {
    const card = show();
    expect(card.querySelector("h2")?.textContent?.trim()).toBe("Order summary");
    expect(card.querySelector("p")?.textContent?.trim()).toBe("Two items, ready to ship.");
  });

  it("shows the order it is given", () => {
    const card = show({ title: "Your order", summary: "Three items, on their way." });
    expect(card.querySelector("h2")?.textContent?.trim()).toBe("Your order");
    expect(card.querySelector("p")?.textContent?.trim()).toBe("Three items, on their way.");
  });
});
