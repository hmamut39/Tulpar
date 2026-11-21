export interface OrderCardProps {
  /** The card's heading. */
  title?: string;
  /** One line about the order. */
  summary?: string;
}

export default function OrderCard({ title = "Order summary", summary = "Two items, ready to ship." }: OrderCardProps) {
  return (
    <section className="m-0 flex flex-col gap-2 bg-card p-4 font-sans" data-figma-id="900:1">
      <h2 className="m-0 text-xl leading-7 font-semibold text-foreground" data-figma-id="900:2">{title}</h2>
      <p className="m-0 text-sm leading-5 font-normal text-muted-foreground" data-figma-id="900:3">{summary}</p>
    </section>
  );
}
