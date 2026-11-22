import "./ProductCard.css";

export interface ProductCardProps {
  productName?: string;
  price?: string;
  originDescription?: string;
  imageSrc?: string;
  imageAlt?: string;
}

const tomatoImage = "/images/heirloom-tomato.jpg";

export default function ProductCard({
  productName = "Heirloom tomato",
  price = "$5.99 / lb",
  originDescription = "Grown in San Juan Capistrano, CA",
  imageSrc = tomatoImage,
  imageAlt = "Heirloom tomato",
}: ProductCardProps = {}) {
  return (
    <article className="product-card" data-figma-id="4368:321208">
      <img
        className="product-card__image"
        data-figma-id="4521:320617"
        src={imageSrc}
        alt={imageAlt}
      />
      <div className="product-card__details">
        <div className="product-card__summary">
          <h2 className="product-card__name" data-figma-id="4368:321210">
            {productName}
          </h2>
          <p className="product-card__price" data-figma-id="4368:321211">
            {price}
          </p>
        </div>
        <p className="product-card__origin" data-figma-id="4368:321212">
          {originDescription}
        </p>
      </div>
    </article>
  );
}
