import { createApp, nextTick } from "vue";
import { describe, expect, it } from "vitest";
import OrderCard from "./OrderCard.vue";

async function show(props: Record<string, string> = {}): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.append(container);
  createApp(OrderCard, props).mount(container);
  await nextTick();
  return container;
}

describe("OrderCard", () => {
  it("shows the design's title and summary by default", async () => {
    const card = await show();
    expect(card.querySelector("h2")?.textContent?.trim()).toBe("Order summary");
    expect(card.querySelector("p")?.textContent?.trim()).toBe("Two items, ready to ship.");
  });

  it("shows the order it is given", async () => {
    const card = await show({ title: "Your order", summary: "Three items, on their way." });
    expect(card.querySelector("h2")?.textContent?.trim()).toBe("Your order");
    expect(card.querySelector("p")?.textContent?.trim()).toBe("Three items, on their way.");
  });
});
