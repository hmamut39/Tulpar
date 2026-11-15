import { TestBed } from "@angular/core/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { OrderCardComponent } from "./order-card.component";

describe("OrderCardComponent", () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [OrderCardComponent] }).compileComponents();
  });

  it("shows the title and the summary", () => {
    const fixture = TestBed.createComponent(OrderCardComponent);
    fixture.detectChanges();
    const host: HTMLElement = fixture.nativeElement;
    expect(host.querySelector("h2")?.textContent?.trim()).toBe("Order summary");
    expect(host.querySelector("p")?.textContent?.trim()).toBe("Two items, ready to ship.");
  });

  it("takes another title through its signal input", () => {
    const fixture = TestBed.createComponent(OrderCardComponent);
    fixture.componentRef.setInput("title", "Your order");
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector("h2")?.textContent?.trim()).toBe("Your order");
  });
});
