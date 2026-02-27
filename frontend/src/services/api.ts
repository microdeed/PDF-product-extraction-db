const API_BASE = '/api';

export interface ProductListItem {
  id: number;
  product_code: string;
  product_name: string;
  product_slogan: string | null;
  subbrand: string | null;
}

export interface PaginatedProducts {
  products: ProductListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface SupplementFact {
  id: number;
  product_id: number;
  servings: string;
  servings_per_container: string;
  calories: string | null;
  protein: string | null;
}

export interface NutritionalValue {
  id: number;
  supplement_fact_id: number;
  nutrient_name: string;
  unit: string | null;
  amount: string | null;
  daily_value_percent_adult: string | null;
  daily_value_percent_children: string | null;
  display_order: number;
}

export interface Ingredient {
  id: number;
  product_id: number;
  ingredient_name: string;
  is_organic: number;
  display_order: number;
}

export interface DietaryAttribute {
  id: number;
  product_id: number;
  attribute_name: string;
}

export interface ProductDetail {
  id: number;
  product_code: string;
  product_name: string;
  product_slogan: string | null;
  product_description: string;
  product_image_path: string | null;
  subbrand: string | null;
  directions: string;
  caution: string | null;
  references: string | null;
  supplement_facts: SupplementFact | null;
  nutritional_values: NutritionalValue[];
  ingredients: Ingredient[];
  dietary_attributes: DietaryAttribute[];
}

export async function fetchProducts(
  page: number = 1,
  pageSize: number = 20,
  subbrand?: string,
  search?: string
): Promise<PaginatedProducts> {
  const params = new URLSearchParams({
    page: page.toString(),
    pageSize: pageSize.toString()
  });

  if (subbrand) params.set('subbrand', subbrand);
  if (search) params.set('search', search);

  const response = await fetch(`${API_BASE}/products?${params}`);
  if (!response.ok) {
    throw new Error('Failed to fetch products');
  }
  return response.json();
}

export async function fetchProduct(code: string): Promise<ProductDetail> {
  const response = await fetch(`${API_BASE}/products/${code}`);
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error('Product not found');
    }
    throw new Error('Failed to fetch product');
  }
  return response.json();
}

export async function fetchSubbrands(): Promise<string[]> {
  const response = await fetch(`${API_BASE}/subbrands`);
  if (!response.ok) {
    throw new Error('Failed to fetch subbrands');
  }
  return response.json();
}

// --- Stats & Compare Interfaces ---

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

// --- Stats & Compare Fetchers ---

export async function fetchOverviewStats(): Promise<OverviewStats> {
  const response = await fetch(`${API_BASE}/stats/overview`);
  if (!response.ok) throw new Error('Failed to fetch overview stats');
  return response.json();
}

export async function fetchIngredientFrequencies(limit: number = 50): Promise<NormalizedIngredientFrequency[]> {
  const response = await fetch(`${API_BASE}/stats/ingredients?limit=${limit}`);
  if (!response.ok) throw new Error('Failed to fetch ingredient frequencies');
  return response.json();
}

export async function fetchIngredientDistribution(): Promise<IngredientDistribution[]> {
  const response = await fetch(`${API_BASE}/stats/distribution`);
  if (!response.ok) throw new Error('Failed to fetch ingredient distribution');
  return response.json();
}

export async function fetchIngredientProducts(normalizedName: string): Promise<IngredientProduct[]> {
  const response = await fetch(`${API_BASE}/stats/ingredients/${encodeURIComponent(normalizedName)}/products`);
  if (!response.ok) throw new Error('Failed to fetch ingredient products');
  return response.json();
}

export async function fetchComparison(codes: string[]): Promise<ComparisonResult> {
  const response = await fetch(`${API_BASE}/compare?codes=${codes.join(',')}`);
  if (!response.ok) throw new Error('Failed to fetch comparison');
  return response.json();
}
