// Reference implementation of Figma "_Modal footer item", variant
// "Actions=2, Cancel=False, Inline loading=False" (node 3906:50588), in Carbon for Angular.
// Hand-written, so the verifier has a known-good baseline to mutate.
import { Component } from "@angular/core";
import { ButtonModule } from "carbon-components-angular/button";
import { ModalModule } from "carbon-components-angular/modal";

@Component({
  selector: "app-modal-actions",
  standalone: true,
  imports: [ButtonModule, ModalModule],
  templateUrl: "./modal-actions.component.html",
  styleUrl: "./modal-actions.component.less",
})
export class ModalActionsComponent {}
