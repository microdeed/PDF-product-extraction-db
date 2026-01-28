import { useState } from 'react';
import { Link } from 'react-router-dom';

function Header() {
  const [isRefreshing, setIsRefreshing] = useState(false);

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

  return (
    <header className="header">
      <div className="header-content">
        <Link to="/" className="header-title">
          <h1>Product Database</h1>
        </Link>
        <div className="header-actions">
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
