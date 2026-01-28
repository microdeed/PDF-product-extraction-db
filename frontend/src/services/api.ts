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
