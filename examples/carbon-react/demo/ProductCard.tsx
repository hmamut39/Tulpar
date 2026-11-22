import "./ProductCard.css";

export default function ProductCard() {
  return (
    <article className="product-card" data-figma-id="4368:321208">
      <img className="product-card__image" data-figma-id="4521:320617" src="/images/heirloom-tomato.jpg" />
      <div className="product-card__details">
        <h2 className="product-card__name" data-figma-id="4368:321210">Heirloom tomato</h2>
        <p className="product-card__price" data-figma-id="4368:321211">$5.99 / lb</p>
        <p className="product-card__origin" data-figma-id="4368:321212">Grown in San Juan Capistrano, CA</p>
      </div>
    </article>
  );
}
