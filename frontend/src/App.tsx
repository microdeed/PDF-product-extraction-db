import { Routes, Route } from 'react-router-dom'
import Header from './components/Header'
import ProductList from './components/ProductList'
import ProductDetail from './components/ProductDetail'
import StatsPage from './components/StatsPage'
import ComparePage from './components/ComparePage'

function App() {
  return (
    <div className="app">
      <Header />
      <main className="main-content">
        <Routes>
          <Route path="/" element={<ProductList />} />
          <Route path="/product/:code" element={<ProductDetail />} />
          <Route path="/stats" element={<StatsPage />} />
          <Route path="/compare" element={<ComparePage />} />
        </Routes>
      </main>
    </div>
  )
}

export default App
