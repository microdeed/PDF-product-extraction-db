import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';

function Header() {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isExportingCSV, setIsExportingCSV] = useState(false);
  const location = useLocation();

  const handleDownload = async (refresh: boolean = false) => {
    if (refresh) {
      setIsRefreshing(true);
      try {
        await fetch('/api/refresh-db', { method: 'POST' });
      } catch (error) {
        console.error('Failed to refresh database:', error);
      }
      setIsRefreshing(false);
    }

    // Trigger download
    const link = document.createElement('a');
    link.href = '/public/products.db';
    link.download = 'products.db';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleDownloadCSV = async () => {
    setIsExportingCSV(true);
    try {
      const link = document.createElement('a');
      link.href = '/api/export-csv';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } finally {
      // Small delay to show the exporting state
      setTimeout(() => setIsExportingCSV(false), 1000);
    }
  };

  const navLinks = [
    { to: '/', label: 'Products' },
    { to: '/stats', label: 'Statistics' },
    { to: '/compare', label: 'Compare' },
  ];

  return (
    <header className="header">
      <div className="header-content">
        <Link to="/" className="header-title">
          <h1>Product Database</h1>
        </Link>
        <nav className="header-nav">
          {navLinks.map(link => (
            <Link
              key={link.to}
              to={link.to}
              className={`nav-link${location.pathname === link.to ? ' nav-link-active' : ''}`}
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="header-actions">
          <button
            className="download-button"
            onClick={handleDownloadCSV}
            disabled={isExportingCSV}
          >
            {isExportingCSV ? 'Exporting...' : 'Download CSV'}
          </button>
          <button
            className="download-button"
            onClick={() => handleDownload(true)}
            disabled={isRefreshing}
          >
            {isRefreshing ? 'Refreshing...' : 'Download DB'}
          </button>
        </div>
      </div>
    </header>
  );
}

export default Header;
