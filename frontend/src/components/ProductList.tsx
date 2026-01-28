import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useProducts, useSubbrands } from '../hooks/useProducts';
import ProductCard from './ProductCard';

function ProductList() {
  const [searchParams, setSearchParams] = useSearchParams();

  // Initialize state from URL params
  const [page, setPage] = useState(() => {
    const p = searchParams.get('page');
    return p ? parseInt(p, 10) : 1;
  });
  const [search, setSearch] = useState(() => searchParams.get('search') || '');
  const [subbrand, setSubbrand] = useState<string | undefined>(() =>
    searchParams.get('subbrand') || undefined
  );
  const [searchInput, setSearchInput] = useState(() => searchParams.get('search') || '');

  // Sync state to URL params
  useEffect(() => {
    const params: Record<string, string> = {};
    if (page > 1) params.page = String(page);
    if (search) params.search = search;
    if (subbrand) params.subbrand = subbrand;
    setSearchParams(params, { replace: true });
  }, [page, search, subbrand, setSearchParams]);

  const { data, isLoading, error } = useProducts(page, 20, subbrand, search);
  const { data: subbrands } = useSubbrands();

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearch(searchInput);
    setPage(1);
  };

  const handleSubbrandChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    setSubbrand(value || undefined);
    setPage(1);
  };

  if (error) {
    return <div className="error">Error loading products: {error.message}</div>;
  }

  return (
    <div className="product-list-container">
      <div className="filters">
        <form onSubmit={handleSearch} className="search-form">
          <input
            type="text"
            placeholder="Search by name or code..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="search-input"
          />
          <button type="submit" className="search-button">Search</button>
        </form>

        <select
          value={subbrand || ''}
          onChange={handleSubbrandChange}
          className="subbrand-filter"
        >
          <option value="">All Subbrands</option>
          {subbrands?.map((sb) => (
            <option key={sb} value={sb}>{sb}</option>
          ))}
        </select>
      </div>

      {isLoading ? (
        <div className="loading">Loading products...</div>
      ) : (
        <>
          <div className="product-grid">
            {data?.products.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>

          {data && data.totalPages > 1 && (
            <div className="pagination">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="pagination-button"
              >
                Previous
              </button>
              <span className="pagination-info">
                Page {data.page} of {data.totalPages} ({data.total} products)
              </span>
              <button
                onClick={() => setPage(p => Math.min(data.totalPages, p + 1))}
                disabled={page === data.totalPages}
                className="pagination-button"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default ProductList;
