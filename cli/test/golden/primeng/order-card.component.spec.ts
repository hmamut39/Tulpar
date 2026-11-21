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

  it("shows the order it is given, through its signal inputs", () => {
    const fixture = TestBed.createComponent(OrderCardComponent);
    fixture.componentRef.setInput("title", "Your order");
    fixture.componentRef.setInput("summary", "Three items, on their way.");
    fixture.detectChanges();
    const host: HTMLElement = fixture.nativeElement;
    expect(host.querySelector("h2")?.textContent?.trim()).toBe("Your order");
    expect(host.querySelector("p")?.textContent?.trim()).toBe("Three items, on their way.");
  });
});
