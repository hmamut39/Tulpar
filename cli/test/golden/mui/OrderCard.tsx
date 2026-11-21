import Typography from "@mui/material/Typography";
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
      <Typography variant="h6" component="h2" className="order-card__title" data-figma-id="900:2">
        {title}
      </Typography>
      <Typography variant="body2" className="order-card__body" data-figma-id="900:3">
        {summary}
      </Typography>
    </section>
  );
}
