import { useParams, useNavigate } from 'react-router-dom';
import { useProduct } from '../hooks/useProducts';
import SupplementFacts from './SupplementFacts';

function ProductDetail() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const { data: product, isLoading, error } = useProduct(code || '');

  const handleBack = () => {
    navigate(-1);
  };

  if (isLoading) {
    return <div className="loading">Loading product...</div>;
  }

  if (error) {
    return (
      <div className="error-container">
        <div className="error">Error: {error.message}</div>
        <button onClick={handleBack} className="back-link">Back to products</button>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="error-container">
        <div className="error">Product not found</div>
        <button onClick={handleBack} className="back-link">Back to products</button>
      </div>
    );
  }

  return (
    <div className="product-detail">
      <button onClick={handleBack} className="back-link">← Back to products</button>

      <div className="product-header">
        <div className="product-header-info">
          <span className="product-code-large">{product.product_code}</span>
          {product.subbrand && (
            <span className="product-subbrand-badge">{product.subbrand}</span>
          )}
        </div>
        <h1 className="product-title">{product.product_name}</h1>
        {product.product_slogan && (
          <p className="product-slogan">{product.product_slogan}</p>
        )}
      </div>

      {product.dietary_attributes.length > 0 && (
        <div className="dietary-attributes">
          {product.dietary_attributes.map((attr) => (
            <span key={attr.id} className="dietary-badge">
              {attr.attribute_name}
            </span>
          ))}
        </div>
      )}

      <div className="product-content">
        <div className="product-main">
          {product.product_description && (
            <section className="product-section">
              <h2>Description</h2>
              <p>{product.product_description}</p>
            </section>
          )}

          {product.supplement_facts && (
            <SupplementFacts
              supplementFacts={product.supplement_facts}
              nutritionalValues={product.nutritional_values}
            />
          )}

          {product.ingredients.length > 0 && (
            <section className="product-section">
              <h2>Ingredients</h2>
              <p className="ingredients-list">
                {product.ingredients.map((ing, index) => (
                  <span key={ing.id}>
                    {ing.is_organic ? (
                      <span className="organic-ingredient">
                        {ing.ingredient_name}*
                      </span>
                    ) : (
                      ing.ingredient_name
                    )}
                    {index < product.ingredients.length - 1 ? ', ' : ''}
                  </span>
                ))}
              </p>
              {product.ingredients.some(i => i.is_organic) && (
                <p className="organic-note">* Organic ingredient</p>
              )}
            </section>
          )}

          {product.directions && (
            <section className="product-section">
              <h2>Directions</h2>
              <p>{product.directions}</p>
            </section>
          )}

          {product.caution && (
            <section className="product-section caution-section">
              <h2>Caution</h2>
              <p>{product.caution}</p>
            </section>
          )}

          {product.references && (
            <section className="product-section">
              <h2>References</h2>
              <p className="references-text">{product.references}</p>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

export default ProductDetail;
