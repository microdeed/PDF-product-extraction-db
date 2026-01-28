import { Router, Request, Response } from 'express';
import {
  getProducts,
  getProductByCode,
  getSubbrands
} from '../services/product-service.js';

const router = Router();

router.get('/products', (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const pageSize = Math.min(parseInt(req.query.pageSize as string) || 20, 100);
    const subbrand = req.query.subbrand as string | undefined;
    const search = req.query.search as string | undefined;

    const result = getProducts(page, pageSize, subbrand, search);
    res.json(result);
  } catch (error) {
    console.error('Error fetching products:', error);
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

router.get('/products/:code', (req: Request, res: Response) => {
  try {
    const { code } = req.params;
    const product = getProductByCode(code);

    if (!product) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }

    res.json(product);
  } catch (error) {
    console.error('Error fetching product:', error);
    res.status(500).json({ error: 'Failed to fetch product' });
  }
});

router.get('/subbrands', (_req: Request, res: Response) => {
  try {
    const subbrands = getSubbrands();
    res.json(subbrands);
  } catch (error) {
    console.error('Error fetching subbrands:', error);
    res.status(500).json({ error: 'Failed to fetch subbrands' });
  }
});

export default router;
