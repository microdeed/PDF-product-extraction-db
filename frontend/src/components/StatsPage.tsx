import { useState, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useOverviewStats, useIngredientFrequencies, useIngredientDistribution, useIngredientProducts } from '../hooks/useStats';
import { fetchProducts, type ProductListItem, type NormalizedIngredientFrequency } from '../services/api';

function IngredientDetailRow({ normalizedName }: { normalizedName: string }) {
  const { data: products, isLoading } = useIngredientProducts(normalizedName);

  return (
    <tr className="ingredient-detail-row">
      <td colSpan={3}>
        {isLoading ? (
          <span className="loading">Loading products...</span>
        ) : products && products.length > 0 ? (
          <div className="ingredient-products">
            {products.map(p => (
              <Link key={p.product_code} to={`/product/${p.product_code}`} className="ingredient-product-link">
                <span className="chip-code">{p.product_code}</span>
                {p.product_name}
              </Link>
            ))}
          </div>
        ) : (
          <span className="text-muted">No products found.</span>
        )}
      </td>
    </tr>
  );
}

function StatsPage() {
  const [ingredientLimit, setIngredientLimit] = useState(50);
  const [ingredientSearch, setIngredientSearch] = useState('');
  const [expandedIngredient, setExpandedIngredient] = useState<string | null>(null);

  // Product filter state
  const [filterSearchTerm, setFilterSearchTerm] = useState('');
  const [filterSearchResults, setFilterSearchResults] = useState<ProductListItem[]>([]);
  const [isFilterSearching, setIsFilterSearching] = useState(false);
  const [showFilterDropdown, setShowFilterDropdown] = useState(false);
  const [filterProduct, setFilterProduct] = useState<ProductListItem | null>(null);
  const filterDropdownRef = useRef<HTMLDivElement>(null);
  const filterDebounceRef = useRef<ReturnType<typeof setTimeout>>();

  const { data: overview, isLoading: overviewLoading } = useOverviewStats();
  const { data: ingredients, isLoading: ingredientsLoading } = useIngredientFrequencies(ingredientLimit);
  const { data: distribution, isLoading: distributionLoading } = useIngredientDistribution();

  // Debounced product filter search
  const doFilterSearch = useCallback(async (term: string) => {
    if (term.length < 2) {
      setFilterSearchResults([]);
      setShowFilterDropdown(false);
      return;
    }
    setIsFilterSearching(true);
    try {
      const result = await fetchProducts(1, 10, undefined, term);
      setFilterSearchResults(result.products);
      setShowFilterDropdown(result.products.length > 0);
    } catch {
      setFilterSearchResults([]);
    } finally {
      setIsFilterSearching(false);
    }
  }, []);

  useEffect(() => {
    if (filterDebounceRef.current) clearTimeout(filterDebounceRef.current);
    filterDebounceRef.current = setTimeout(() => doFilterSearch(filterSearchTerm), 300);
    return () => { if (filterDebounceRef.current) clearTimeout(filterDebounceRef.current); };
  }, [filterSearchTerm, doFilterSearch]);

  // Close filter dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (filterDropdownRef.current && !filterDropdownRef.current.contains(e.target as Node)) {
        setShowFilterDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const selectFilterProduct = (product: ProductListItem) => {
    setFilterProduct(product);
    setFilterSearchTerm('');
    setShowFilterDropdown(false);
  };

  const clearFilterProduct = () => {
    setFilterProduct(null);
  };

  if (overviewLoading) return <div className="loading">Loading statistics...</div>;

  const maxSubbrandCount = overview ? Math.max(...overview.productsPerSubbrand.map(s => s.count)) : 1;
  const maxDistCount = distribution ? Math.max(...distribution.map(d => d.count)) : 1;

  // Filter ingredients by search and product filter
  let filteredIngredients: NormalizedIngredientFrequency[] = ingredients || [];

  if (ingredientSearch.trim()) {
    const term = ingredientSearch.toLowerCase();
    filteredIngredients = filteredIngredients.filter(ing =>
      ing.displayName.toLowerCase().includes(term) ||
      ing.normalizedName.toLowerCase().includes(term)
    );
  }

  if (filterProduct) {
    filteredIngredients = filteredIngredients.filter(ing =>
      ing.products.some(p => p.product_code === filterProduct.product_code)
    );
  }

  // Split into two columns
  const midpoint = Math.ceil(filteredIngredients.length / 2);
  const leftColumn = filteredIngredients.slice(0, midpoint);
  const rightColumn = filteredIngredients.slice(midpoint);

  const toggleExpanded = (normalizedName: string) => {
    setExpandedIngredient(prev => prev === normalizedName ? null : normalizedName);
  };

  const renderIngredientTable = (items: NormalizedIngredientFrequency[], startRank: number) => (
    <table className="freq-table">
      <thead>
        <tr>
          <th className="freq-rank">#</th>
          <th>Ingredient</th>
          <th className="freq-count">Products</th>
        </tr>
      </thead>
      <tbody>
        {items.map((ing, idx) => (
          <IngredientRow
            key={ing.normalizedName}
            ing={ing}
            rank={startRank + idx}
            isExpanded={expandedIngredient === ing.normalizedName}
            onToggle={() => toggleExpanded(ing.normalizedName)}
          />
        ))}
      </tbody>
    </table>
  );

  return (
    <div className="stats-page">
      <h1 className="page-title">Statistics</h1>

      {/* Overview Cards */}
      {overview && (
        <div className="stat-cards">
          <div className="stat-card">
            <div className="stat-value">{overview.totalProducts}</div>
            <div className="stat-label">Products</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{overview.totalNormalizedIngredients}</div>
            <div className="stat-label">Unique Ingredients</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{overview.totalSubbrands}</div>
            <div className="stat-label">Subbrands</div>
          </div>
        </div>
      )}

      {/* Products by Subbrand */}
      {overview && overview.productsPerSubbrand.length > 0 && (
        <section className="stats-section">
          <h2>Products by Subbrand</h2>
          <div className="bar-chart">
            {overview.productsPerSubbrand.map(s => (
              <div key={s.subbrand} className="bar-row">
                <span className="bar-label">{s.subbrand}</span>
                <div className="bar-track">
                  <div
                    className="bar-fill"
                    style={{ width: `${(s.count / maxSubbrandCount) * 100}%` }}
                  />
                </div>
                <span className="bar-value">{s.count}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Most Common Ingredients */}
      <section className="stats-section">
        <h2>Most Common Ingredients</h2>

        {/* Filter Bar */}
        <div className="ingredient-filter-bar">
          <input
            type="text"
            className="search-input"
            placeholder="Search ingredients..."
            value={ingredientSearch}
            onChange={e => setIngredientSearch(e.target.value)}
          />
          <div className="product-filter-wrap" ref={filterDropdownRef}>
            {filterProduct ? (
              <span className="compare-chip">
                <span className="chip-code">{filterProduct.product_code}</span>
                {filterProduct.product_name}
                <button className="chip-remove" onClick={clearFilterProduct}>
                  &times;
                </button>
              </span>
            ) : (
              <input
                type="text"
                className="search-input"
                placeholder="Filter by product..."
                value={filterSearchTerm}
                onChange={e => setFilterSearchTerm(e.target.value)}
                onFocus={() => { if (filterSearchResults.length > 0) setShowFilterDropdown(true); }}
              />
            )}
            {isFilterSearching && <span className="search-spinner">Searching...</span>}
            {showFilterDropdown && (
              <div className="compare-dropdown">
                {filterSearchResults.map(p => (
                  <button
                    key={p.product_code}
                    className="compare-dropdown-item"
                    onClick={() => selectFilterProduct(p)}
                  >
                    <span className="product-code">{p.product_code}</span>
                    <span>{p.product_name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {ingredientsLoading ? (
          <div className="loading">Loading ingredients...</div>
        ) : filteredIngredients.length > 0 ? (
          <>
            <div className="freq-table-grid">
              <div className="freq-table-col">
                {renderIngredientTable(leftColumn, 1)}
              </div>
              {rightColumn.length > 0 && (
                <div className="freq-table-col">
                  {renderIngredientTable(rightColumn, midpoint + 1)}
                </div>
              )}
            </div>
            {!ingredientSearch && !filterProduct && (
              <button
                className="show-more-button"
                onClick={() => setIngredientLimit(prev => prev + 50)}
              >
                Show more
              </button>
            )}
          </>
        ) : (
          <p>No ingredients match your filters.</p>
        )}
      </section>

      {/* Ingredient Count Distribution */}
      <section className="stats-section">
        <h2>Ingredient Count Distribution</h2>
        {distributionLoading ? (
          <div className="loading">Loading distribution...</div>
        ) : distribution && (
          <div className="histogram">
            {distribution.map(d => (
              <div key={d.bucket} className="histogram-col">
                <div className="histogram-bar-wrap">
                  <div
                    className="histogram-bar"
                    style={{ height: `${maxDistCount > 0 ? (d.count / maxDistCount) * 100 : 0}%` }}
                  >
                    {d.count > 0 && <span className="histogram-count">{d.count}</span>}
                  </div>
                </div>
                <div className="histogram-label">{d.bucket}</div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* AI Analysis Placeholder */}
      <section className="stats-section ai-placeholder">
        <h2>AI Analysis</h2>
        <p>Coming Soon — Automated ingredient pattern analysis, anomaly detection, and product recommendations.</p>
      </section>
    </div>
  );
}

function IngredientRow({
  ing,
  rank,
  isExpanded,
  onToggle,
}: {
  ing: NormalizedIngredientFrequency;
  rank: number;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr
        className={isExpanded ? 'freq-row-expanded' : ''}
        onClick={onToggle}
      >
        <td className="freq-rank">{rank}</td>
        <td>
          <span className="freq-name">{ing.displayName}</span>
          {ing.isOrganic && <span className="freq-organic"> (organic)</span>}
          {ing.variants.length > 1 && (
            <span className="freq-variants"> +{ing.variants.length - 1} variant{ing.variants.length > 2 ? 's' : ''}</span>
          )}
        </td>
        <td className="freq-count">{ing.productCount}</td>
      </tr>
      {isExpanded && <IngredientDetailRow normalizedName={ing.normalizedName} />}
    </>
  );
}

export default StatsPage;
