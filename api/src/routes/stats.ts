import { Router } from 'express';
import {
  getOverviewStats,
  getIngredientFrequencies,
  getIngredientDistribution,
  getComparison,
  getProductsByIngredient,
} from '../services/stats-service.js';

const router = Router();

router.get('/stats/overview', (_req, res) => {
  try {
    const stats = getOverviewStats();
    res.json(stats);
  } catch (error) {
    console.error('Error fetching overview stats:', error);
    res.status(500).json({ error: 'Failed to fetch overview stats' });
  }
});

router.get('/stats/ingredients', (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const ingredients = getIngredientFrequencies(limit);
    res.json(ingredients);
  } catch (error) {
    console.error('Error fetching ingredient frequencies:', error);
    res.status(500).json({ error: 'Failed to fetch ingredient frequencies' });
  }
});

router.get('/stats/ingredients/:normalizedName/products', (req, res) => {
  try {
    const normalizedName = decodeURIComponent(req.params.normalizedName);
    const products = getProductsByIngredient(normalizedName);
    res.json(products);
  } catch (error) {
    console.error('Error fetching products by ingredient:', error);
    res.status(500).json({ error: 'Failed to fetch products by ingredient' });
  }
});

router.get('/stats/distribution', (_req, res) => {
  try {
    const distribution = getIngredientDistribution();
    res.json(distribution);
  } catch (error) {
    console.error('Error fetching ingredient distribution:', error);
    res.status(500).json({ error: 'Failed to fetch ingredient distribution' });
  }
});

router.get('/compare', (req, res) => {
  try {
    const codesParam = req.query.codes as string;
    if (!codesParam) {
      res.status(400).json({ error: 'codes query parameter is required' });
      return;
    }

    const codes = codesParam.split(',').map(c => c.trim()).filter(Boolean);
    if (codes.length < 2 || codes.length > 10) {
      res.status(400).json({ error: 'Between 2 and 10 product codes are required' });
      return;
    }

    const result = getComparison(codes);
    res.json(result);
  } catch (error) {
    console.error('Error fetching comparison:', error);
    res.status(500).json({ error: 'Failed to fetch comparison' });
  }
});

export default router;
