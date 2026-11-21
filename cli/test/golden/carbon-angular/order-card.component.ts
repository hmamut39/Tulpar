import { ChangeDetectionStrategy, Component, input } from "@angular/core";

@Component({
  selector: "app-order-card",
  standalone: true,
  templateUrl: "./order-card.component.html",
  styleUrl: "./order-card.component.css",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OrderCardComponent {
  /** The card's heading. */
  readonly title = input("Order summary");
  /** One line about the order. */
  readonly summary = input("Two items, ready to ship.");
}
