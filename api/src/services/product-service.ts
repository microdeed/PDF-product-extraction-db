import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, '../../../products.db');

let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH, { readonly: true });
    db.pragma('journal_mode = WAL');
  }
  return db;
}

export interface Product {
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

export interface ProductListItem {
  id: number;
  product_code: string;
  product_name: string;
  product_slogan: string | null;
  subbrand: string | null;
}

export interface ProductDetail extends Product {
  supplement_facts: SupplementFact | null;
  nutritional_values: NutritionalValue[];
  ingredients: Ingredient[];
  dietary_attributes: DietaryAttribute[];
}

export interface PaginatedProducts {
  products: ProductListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export function getProducts(
  page: number = 1,
  pageSize: number = 20,
  subbrand?: string,
  search?: string
): PaginatedProducts {
  const db = getDb();
  const offset = (page - 1) * pageSize;

  let whereClause = "WHERE extraction_status = 'completed'";
  const params: (string | number)[] = [];

  if (subbrand) {
    whereClause += ' AND subbrand = ?';
    params.push(subbrand);
  }

  if (search) {
    whereClause += ' AND (product_name LIKE ? OR product_code LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }

  const countStmt = db.prepare(`
    SELECT COUNT(*) as count FROM products ${whereClause}
  `);
  const { count: total } = countStmt.get(...params) as { count: number };

  const stmt = db.prepare(`
    SELECT id, product_code, product_name, product_slogan, subbrand
    FROM products
    ${whereClause}
    ORDER BY product_code ASC
    LIMIT ? OFFSET ?
  `);

  const products = stmt.all(...params, pageSize, offset) as ProductListItem[];

  return {
    products,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize)
  };
}

export function getProductByCode(code: string): ProductDetail | null {
  const db = getDb();

  const productStmt = db.prepare(`
    SELECT id, product_code, product_name, product_slogan, product_description,
           product_image_path, subbrand, directions, caution, \`references\`
    FROM products
    WHERE product_code = ? AND extraction_status = 'completed'
  `);
  const product = productStmt.get(code) as Product | undefined;

  if (!product) {
    return null;
  }

  const sfStmt = db.prepare(`
    SELECT id, product_id, servings, servings_per_container, calories, protein
    FROM supplement_facts
    WHERE product_id = ?
  `);
  const supplementFacts = sfStmt.get(product.id) as SupplementFact | undefined;

  let nutritionalValues: NutritionalValue[] = [];
  if (supplementFacts) {
    const nvStmt = db.prepare(`
      SELECT id, supplement_fact_id, nutrient_name, unit, amount,
             daily_value_percent_adult, daily_value_percent_children, display_order
      FROM nutritional_values
      WHERE supplement_fact_id = ?
      ORDER BY display_order ASC
    `);
    nutritionalValues = nvStmt.all(supplementFacts.id) as NutritionalValue[];
  }

  const ingStmt = db.prepare(`
    SELECT id, product_id, ingredient_name, is_organic, display_order
    FROM ingredients
    WHERE product_id = ?
    ORDER BY display_order ASC
  `);
  const ingredients = ingStmt.all(product.id) as Ingredient[];

  const daStmt = db.prepare(`
    SELECT id, product_id, attribute_name
    FROM dietary_attributes
    WHERE product_id = ?
  `);
  const dietaryAttributes = daStmt.all(product.id) as DietaryAttribute[];

  return {
    ...product,
    supplement_facts: supplementFacts || null,
    nutritional_values: nutritionalValues,
    ingredients,
    dietary_attributes: dietaryAttributes
  };
}

export function getSubbrands(): string[] {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT DISTINCT subbrand
    FROM products
    WHERE subbrand IS NOT NULL AND extraction_status = 'completed'
    ORDER BY subbrand ASC
  `);
  const results = stmt.all() as { subbrand: string }[];
  return results.map(r => r.subbrand);
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

process.on('exit', closeDb);
process.on('SIGINT', () => {
  closeDb();
  process.exit(0);
});
process.on('SIGTERM', () => {
  closeDb();
  process.exit(0);
});
