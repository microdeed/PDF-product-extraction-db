import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { copyFileSync, existsSync, mkdirSync } from 'fs';
import productRoutes from './routes/products.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// Paths for database files
const sourceDbPath = path.resolve(__dirname, '../../products.db');
const publicDir = path.resolve(__dirname, '../public');
const publicDbPath = path.join(publicDir, 'products.db');

// Ensure public directory exists
if (!existsSync(publicDir)) {
  mkdirSync(publicDir, { recursive: true });
}

// Initial copy of database to public folder
if (existsSync(sourceDbPath) && !existsSync(publicDbPath)) {
  copyFileSync(sourceDbPath, publicDbPath);
}

app.use(cors());
app.use(express.json());

// Serve static files from public directory
app.use('/public', express.static(publicDir));

app.use('/api', productRoutes);

// Endpoint to refresh the database copy
app.post('/api/refresh-db', (_req, res) => {
  try {
    if (!existsSync(sourceDbPath)) {
      res.status(404).json({ error: 'Source database not found' });
      return;
    }
    copyFileSync(sourceDbPath, publicDbPath);
    res.json({ success: true, message: 'Database refreshed successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to refresh database' });
  }
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`API server running on http://localhost:${PORT}`);
});
