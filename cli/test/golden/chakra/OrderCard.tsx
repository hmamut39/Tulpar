import "./OrderCard.css";

export interface OrderCardProps {
  /** The card's heading. */
  title?: string;
  /** One line about the order. */
  summary?: string;
}

export default function OrderCard({ title = "Order summary", summary = "Two items, ready to ship." }: OrderCardProps) {
  return (
    <section className="order-card" data-figma-id="900:1">
      <h2 className="order-card__title" data-figma-id="900:2">{title}</h2>
      <p className="order-card__body" data-figma-id="900:3">{summary}</p>
    </section>
  );
}
