import { createApp, nextTick } from "vue";
import { describe, expect, it } from "vitest";
import OrderCard from "./OrderCard.vue";

describe("OrderCard", () => {
  it("shows the title and the summary", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    createApp(OrderCard).mount(container);
    await nextTick();
    expect(container.querySelector("h2")?.textContent?.trim()).toBe("Order summary");
    expect(container.querySelector("p")?.textContent?.trim()).toBe("Two items, ready to ship.");
  });
});
