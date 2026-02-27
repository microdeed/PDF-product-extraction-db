import { useState, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useComparison } from '../hooks/useStats';
import { fetchProducts, type ProductListItem } from '../services/api';

function ComparePage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<ProductListItem[]>([]);
  const [browseResults, setBrowseResults] = useState<ProductListItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedProducts, setSelectedProducts] = useState<ProductListItem[]>([]);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const selectedCodes = selectedProducts.map(p => p.product_code);
  const { data: comparison, isLoading: comparisonLoading } = useComparison(selectedCodes);

  // Load browse list on mount (all products, first page)
  useEffect(() => {
    fetchProducts(1, 100).then(result => {
      setBrowseResults(result.products);
    }).catch(() => {});
  }, []);

  // Debounced search
  const doSearch = useCallback(async (term: string) => {
    if (term.length < 2) {
      setSearchResults([]);
      return;
    }
    setIsSearching(true);
    try {
      const result = await fetchProducts(1, 10, undefined, term);
      setSearchResults(result.products);
    } catch {
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(searchTerm), 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [searchTerm, doSearch]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Determine which items to show in dropdown
  const dropdownItems = searchTerm.length >= 2
    ? searchResults.filter(p => !selectedCodes.includes(p.product_code))
    : browseResults.filter(p => !selectedCodes.includes(p.product_code));

  const addProduct = (product: ProductListItem) => {
    if (selectedProducts.length >= 10) return;
    setSelectedProducts(prev => [...prev, product]);
    setSearchTerm('');
    setShowDropdown(false);
  };

  const removeProduct = (code: string) => {
    setSelectedProducts(prev => prev.filter(p => p.product_code !== code));
  };

  return (
    <div className="compare-page">
      <h1 className="page-title">Compare Products</h1>

      {/* Search & Select */}
      <div className="compare-search" ref={dropdownRef}>
        <input
          type="text"
          className="search-input"
          placeholder="Search or click to browse products..."
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          onFocus={() => setShowDropdown(true)}
        />
        {isSearching && <span className="search-spinner">Searching...</span>}
        {showDropdown && dropdownItems.length > 0 && (
          <div className="compare-dropdown">
            {dropdownItems.map(p => (
              <button
                key={p.product_code}
                className="compare-dropdown-item"
                onClick={() => addProduct(p)}
              >
                <span className="product-code">{p.product_code}</span>
                <span>{p.product_name}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Selected Product Chips — now link to product pages */}
      {selectedProducts.length > 0 && (
        <div className="compare-chips">
          {selectedProducts.map(p => (
            <span key={p.product_code} className="compare-chip">
              <Link to={`/product/${p.product_code}`} className="chip-link">
                <span className="chip-code">{p.product_code}</span>
                {p.product_name}
              </Link>
              <button className="chip-remove" onClick={() => removeProduct(p.product_code)}>
                &times;
              </button>
            </span>
          ))}
        </div>
      )}

      {selectedCodes.length < 2 && (
        <p className="compare-hint">Select at least 2 products to compare their ingredients.</p>
      )}

      {/* Comparison Results */}
      {comparisonLoading && <div className="loading">Loading comparison...</div>}

      {comparison && (
        <>
          {/* Summary Cards */}
          <div className="stat-cards">
            <div className="stat-card">
              <div className="stat-value">{comparison.allNormalizedIngredients.length}</div>
              <div className="stat-label">Total Unique</div>
            </div>
            <div className="stat-card stat-card-shared">
              <div className="stat-value">{comparison.sharedCount}</div>
              <div className="stat-label">Shared</div>
            </div>
            <div className="stat-card stat-card-unique">
              <div className="stat-value">{comparison.uniqueCount}</div>
              <div className="stat-label">Unique to One</div>
            </div>
          </div>

          {/* Legend */}
          <div className="compare-legend">
            <div className="legend-item">
              <span className="compare-present" />
              <span>Present</span>
            </div>
            <div className="legend-item">
              <span className="compare-absent">&mdash;</span>
              <span>Not present</span>
            </div>
            <div className="legend-item">
              <span className="legend-swatch legend-swatch-shared" />
              <span>Shared by all</span>
            </div>
            <div className="legend-item">
              <span className="legend-swatch legend-swatch-unique" />
              <span>Unique to one</span>
            </div>
          </div>

          {/* Comparison Matrix — column headers link to product pages */}
          <section className="stats-section">
            <h2>Ingredient Comparison</h2>
            <div className="compare-table-wrap">
              <table className="compare-table">
                <thead>
                  <tr>
                    <th className="compare-ingredient-col">Ingredient</th>
                    {comparison.products.map(p => (
                      <th key={p.product_code} className="compare-product-col">
                        <Link to={`/product/${p.product_code}`} className="compare-col-link">
                          <div className="compare-col-code">{p.product_code}</div>
                          <div className="compare-col-name">{p.product_name}</div>
                        </Link>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {comparison.allNormalizedIngredients.map(ing => {
                    const isShared = ing.presentIn.length === comparison.products.length;
                    const isUnique = ing.presentIn.length === 1;
                    const rowClass = isShared ? 'compare-row-shared' : isUnique ? 'compare-row-unique' : '';
                    return (
                      <tr key={ing.normalizedName} className={rowClass}>
                        <td className="compare-ingredient-name">{ing.displayName}</td>
                        {comparison.products.map(p => (
                          <td key={p.product_code} className="compare-cell">
                            {ing.presentIn.includes(p.product_code) ? (
                              <span className="compare-present" />
                            ) : (
                              <span className="compare-absent">&mdash;</span>
                            )}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {/* AI Analysis Placeholder */}
          <section className="stats-section ai-placeholder">
            <h2>Combined AI Analysis</h2>
            <p>Coming Soon — Cross-product ingredient analysis, synergy detection, and gap identification.</p>
          </section>
        </>
      )}
    </div>
  );
}

export default ComparePage;
