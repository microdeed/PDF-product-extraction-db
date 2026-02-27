import { getDb } from './db.js';

// --- Normalization ---

export function normalizeIngredientName(raw: string): string {
  let name = raw.toLowerCase().trim();
  // Remove parenthetical qualifiers
  name = name.replace(/\s*\([^)]*\)/g, '');
  // Remove trademark symbols
  name = name.replace(/[™®©]/g, '');
  name = name.replace(/\b(tm|®)\b/gi, '');
  // Collapse whitespace
  name = name.replace(/\s+/g, ' ').trim();
  // Remove trailing punctuation
  name = name.replace(/[.,;:]+$/, '');
  return name;
}

// --- Interfaces ---

export interface OverviewStats {
  totalProducts: number;
  totalNormalizedIngredients: number;
  totalSubbrands: number;
  productsPerSubbrand: { subbrand: string; count: number }[];
}

export interface NormalizedIngredientFrequency {
  normalizedName: string;
  displayName: string;
  productCount: number;
  variants: string[];
  isOrganic: boolean;
  products: { product_code: string; product_name: string }[];
}

export interface IngredientProduct {
  product_code: string;
  product_name: string;
  subbrand: string | null;
}

export interface IngredientDistribution {
  bucket: string;
  count: number;
}

export interface ProductComparisonItem {
  product_code: string;
  product_name: string;
  ingredients: { normalizedName: string; displayName: string; isOrganic: boolean }[];
}

export interface ComparisonResult {
  products: ProductComparisonItem[];
  allNormalizedIngredients: {
    normalizedName: string;
    displayName: string;
    presentIn: string[];
  }[];
  sharedCount: number;
  uniqueCount: number;
}

// --- Queries ---

export function getOverviewStats(): OverviewStats {
  const db = getDb();

  const { count: totalProducts } = db.prepare(
    `SELECT COUNT(*) as count FROM products WHERE extraction_status = 'completed'`
  ).get() as { count: number };

  // Get all ingredients and normalize to count unique
  const allIngredients = db.prepare(`
    SELECT DISTINCT i.ingredient_name
    FROM ingredients i
    JOIN products p ON i.product_id = p.id
    WHERE p.extraction_status = 'completed'
  `).all() as { ingredient_name: string }[];

  const normalizedSet = new Set(allIngredients.map(r => normalizeIngredientName(r.ingredient_name)));
  const totalNormalizedIngredients = normalizedSet.size;

  const { count: totalSubbrands } = db.prepare(`
    SELECT COUNT(DISTINCT subbrand) as count
    FROM products
    WHERE subbrand IS NOT NULL AND extraction_status = 'completed'
  `).get() as { count: number };

  const productsPerSubbrand = db.prepare(`
    SELECT subbrand, COUNT(*) as count
    FROM products
    WHERE subbrand IS NOT NULL AND extraction_status = 'completed'
    GROUP BY subbrand
    ORDER BY count DESC
  `).all() as { subbrand: string; count: number }[];

  return { totalProducts, totalNormalizedIngredients, totalSubbrands, productsPerSubbrand };
}

export function getIngredientFrequencies(limit: number = 50): NormalizedIngredientFrequency[] {
  const db = getDb();

  // Get all ingredients with their product associations
  const rows = db.prepare(`
    SELECT i.ingredient_name, i.is_organic, p.product_code, p.product_name
    FROM ingredients i
    JOIN products p ON i.product_id = p.id
    WHERE p.extraction_status = 'completed'
  `).all() as { ingredient_name: string; is_organic: number; product_code: string; product_name: string }[];

  // Group by normalized name
  const groups = new Map<string, {
    variants: Map<string, number>;
    products: Map<string, string>; // product_code -> product_name
    isOrganic: boolean;
  }>();

  for (const row of rows) {
    const normalized = normalizeIngredientName(row.ingredient_name);
    if (!groups.has(normalized)) {
      groups.set(normalized, { variants: new Map(), products: new Map(), isOrganic: false });
    }
    const group = groups.get(normalized)!;
    group.variants.set(row.ingredient_name, (group.variants.get(row.ingredient_name) || 0) + 1);
    group.products.set(row.product_code, row.product_name);
    if (row.is_organic) group.isOrganic = true;
  }

  // Convert to array, pick display name as most frequent variant
  const results: NormalizedIngredientFrequency[] = [];
  for (const [normalizedName, group] of groups) {
    let displayName = '';
    let maxCount = 0;
    for (const [variant, count] of group.variants) {
      if (count > maxCount) {
        maxCount = count;
        displayName = variant;
      }
    }

    results.push({
      normalizedName,
      displayName,
      productCount: group.products.size,
      variants: Array.from(group.variants.keys()),
      isOrganic: group.isOrganic,
      products: Array.from(group.products.entries()).map(([product_code, product_name]) => ({ product_code, product_name })),
    });
  }

  // Sort by product count descending
  results.sort((a, b) => b.productCount - a.productCount);
  return results.slice(0, limit);
}

export function getIngredientDistribution(): IngredientDistribution[] {
  const db = getDb();

  const rows = db.prepare(`
    SELECT p.id, COUNT(i.id) as ingredient_count
    FROM products p
    LEFT JOIN ingredients i ON i.product_id = p.id
    WHERE p.extraction_status = 'completed'
    GROUP BY p.id
  `).all() as { id: number; ingredient_count: number }[];

  const buckets: Record<string, number> = {
    '0': 0,
    '1-5': 0,
    '6-10': 0,
    '11-20': 0,
    '21-30': 0,
    '31+': 0,
  };

  for (const row of rows) {
    const c = row.ingredient_count;
    if (c === 0) buckets['0']++;
    else if (c <= 5) buckets['1-5']++;
    else if (c <= 10) buckets['6-10']++;
    else if (c <= 20) buckets['11-20']++;
    else if (c <= 30) buckets['21-30']++;
    else buckets['31+']++;
  }

  return Object.entries(buckets).map(([bucket, count]) => ({ bucket, count }));
}

export function getProductsByIngredient(normalizedName: string): IngredientProduct[] {
  const db = getDb();

  const rows = db.prepare(`
    SELECT i.ingredient_name, p.product_code, p.product_name, p.subbrand
    FROM ingredients i
    JOIN products p ON i.product_id = p.id
    WHERE p.extraction_status = 'completed'
  `).all() as { ingredient_name: string; product_code: string; product_name: string; subbrand: string | null }[];

  const seen = new Set<string>();
  const results: IngredientProduct[] = [];

  for (const row of rows) {
    const normalized = normalizeIngredientName(row.ingredient_name);
    if (normalized === normalizedName && !seen.has(row.product_code)) {
      seen.add(row.product_code);
      results.push({
        product_code: row.product_code,
        product_name: row.product_name,
        subbrand: row.subbrand,
      });
    }
  }

  return results;
}

export function getComparison(codes: string[]): ComparisonResult {
  const db = getDb();

  const products: ProductComparisonItem[] = [];

  for (const code of codes) {
    const product = db.prepare(`
      SELECT id, product_code, product_name
      FROM products
      WHERE product_code = ? AND extraction_status = 'completed'
    `).get(code) as { id: number; product_code: string; product_name: string } | undefined;

    if (!product) continue;

    const ingredients = db.prepare(`
      SELECT ingredient_name, is_organic
      FROM ingredients
      WHERE product_id = ?
      ORDER BY display_order ASC
    `).all(product.id) as { ingredient_name: string; is_organic: number }[];

    products.push({
      product_code: product.product_code,
      product_name: product.product_name,
      ingredients: ingredients.map(i => ({
        normalizedName: normalizeIngredientName(i.ingredient_name),
        displayName: i.ingredient_name,
        isOrganic: !!i.is_organic,
      })),
    });
  }

  // Build merged ingredient list
  const ingredientMap = new Map<string, { displayName: string; presentIn: Set<string> }>();

  for (const product of products) {
    for (const ing of product.ingredients) {
      if (!ingredientMap.has(ing.normalizedName)) {
        ingredientMap.set(ing.normalizedName, { displayName: ing.displayName, presentIn: new Set() });
      }
      ingredientMap.get(ing.normalizedName)!.presentIn.add(product.product_code);
    }
  }

  const allNormalizedIngredients = Array.from(ingredientMap.entries()).map(
    ([normalizedName, { displayName, presentIn }]) => ({
      normalizedName,
      displayName,
      presentIn: Array.from(presentIn),
    })
  );

  // Sort: shared first, then by name
  allNormalizedIngredients.sort((a, b) => {
    if (b.presentIn.length !== a.presentIn.length) return b.presentIn.length - a.presentIn.length;
    return a.normalizedName.localeCompare(b.normalizedName);
  });

  const totalProducts = products.length;
  const sharedCount = allNormalizedIngredients.filter(i => i.presentIn.length === totalProducts).length;
  const uniqueCount = allNormalizedIngredients.filter(i => i.presentIn.length === 1).length;

  return { products, allNormalizedIngredients, sharedCount, uniqueCount };
}
