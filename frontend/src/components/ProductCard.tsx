import { Link } from 'react-router-dom';
import type { ProductListItem } from '../services/api';

interface ProductCardProps {
  product: ProductListItem;
}

function ProductCard({ product }: ProductCardProps) {
  return (
    <Link to={`/product/${product.product_code}`} className="product-card">
      <div className="product-card-header">
        <span className="product-code">{product.product_code}</span>
        {product.subbrand && (
          <span className="product-subbrand">{product.subbrand}</span>
        )}
      </div>
      <h3 className="product-card-name">{product.product_name}</h3>
      {product.product_slogan && (
        <p className="product-card-slogan">{product.product_slogan}</p>
      )}
    </Link>
  );
}

export default ProductCard;
