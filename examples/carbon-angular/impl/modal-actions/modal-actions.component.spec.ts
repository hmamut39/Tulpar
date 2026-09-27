import { TestBed } from "@angular/core/testing";
import { ModalActionsComponent } from "./modal-actions.component";

describe("ModalActionsComponent", () => {
  it("shows both actions", async () => {
    await TestBed.configureTestingModule({ imports: [ModalActionsComponent] }).compileComponents();
    const fixture = TestBed.createComponent(ModalActionsComponent);
    fixture.detectChanges();
    const buttons = fixture.nativeElement.querySelectorAll("button[cdsButton]");
    expect(buttons.length).toBe(2);
  });
});
