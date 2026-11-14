import { ChangeDetectionStrategy, Component, input } from "@angular/core";

@Component({
  selector: "app-order-card",
  standalone: true,
  templateUrl: "./order-card.component.html",
  styleUrl: "./order-card.component.css",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OrderCardComponent {
  readonly title = input("Order summary");
}
