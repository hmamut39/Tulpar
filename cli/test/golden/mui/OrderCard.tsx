import Typography from "@mui/material/Typography";
import "./OrderCard.css";

export default function OrderCard() {
  return (
    <section className="order-card" data-figma-id="900:1">
      <Typography variant="h6" component="h2" className="order-card__title" data-figma-id="900:2">
        Order summary
      </Typography>
      <Typography variant="body2" className="order-card__body" data-figma-id="900:3">
        Two items, ready to ship.
      </Typography>
    </section>
  );
}
