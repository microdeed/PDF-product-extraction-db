import Database from 'better-sqlite3';
import logger from '../utils/logger.js';

export const SCHEMA_VERSION = 5;

export function initializeDatabase(db: Database.Database): void {
  logger.info('Initializing database schema...');

  // Enable foreign keys
  db.pragma('foreign_keys = ON');

  // Enable WAL mode for better performance
  db.pragma('journal_mode = WAL');

  // Create schema version table
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Check current version
  const currentVersion = db.prepare('SELECT MAX(version) as version FROM schema_version').get() as { version: number | null };

  if (currentVersion.version === SCHEMA_VERSION) {
    logger.info(`Database schema is up to date (version ${SCHEMA_VERSION})`);
    return;
  }

  // Apply migrations
  db.transaction(() => {
    const currentVer = currentVersion.version || 0;

    // Version 1: Initial schema
    if (currentVer < 1) {
      logger.info('Applying migration to version 1...');

      // Products table - main product information
      db.exec(`
        CREATE TABLE IF NOT EXISTS products (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          product_code TEXT NOT NULL UNIQUE,
          product_name TEXT NOT NULL,
          product_slogan TEXT,
          product_description TEXT,
          product_image_path TEXT,
          subbrand TEXT,
          directions TEXT,
          caution TEXT,
          "references" TEXT,
          pdf_file_path TEXT NOT NULL,
          folder_path TEXT NOT NULL,
          extraction_date DATETIME DEFAULT CURRENT_TIMESTAMP,
          extraction_status TEXT DEFAULT 'pending' CHECK(extraction_status IN ('pending', 'processing', 'completed', 'failed')),
          error_message TEXT,
          raw_ai_response TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Create indexes for products table
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_products_code ON products(product_code);
        CREATE INDEX IF NOT EXISTS idx_products_status ON products(extraction_status);
        CREATE INDEX IF NOT EXISTS idx_products_subbrand ON products(subbrand);
      `);

      // Supplement facts table - nutritional information
      db.exec(`
        CREATE TABLE IF NOT EXISTS supplement_facts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          product_id INTEGER NOT NULL UNIQUE,
          servings TEXT,
          servings_per_container TEXT,
          calories TEXT,
          protein TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
        )
      `);

      // Nutritional values table - individual nutrients
      db.exec(`
        CREATE TABLE IF NOT EXISTS nutritional_values (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          supplement_fact_id INTEGER NOT NULL,
          nutrient_name TEXT NOT NULL,
          amount TEXT NOT NULL,
          daily_value_percent TEXT,
          display_order INTEGER DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (supplement_fact_id) REFERENCES supplement_facts(id) ON DELETE CASCADE
        )
      `);

      // Create index for nutritional values
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_nutritional_values_supplement ON nutritional_values(supplement_fact_id);
      `);

      // Ingredients table - product ingredients
      db.exec(`
        CREATE TABLE IF NOT EXISTS ingredients (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          product_id INTEGER NOT NULL,
          ingredient_name TEXT NOT NULL,
          is_organic INTEGER DEFAULT 0,
          display_order INTEGER DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
        )
      `);

      // Create index for ingredients
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_ingredients_product ON ingredients(product_id);
      `);

      // Dietary attributes table - vegetarian, vegan, gluten-free, etc.
      db.exec(`
        CREATE TABLE IF NOT EXISTS dietary_attributes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          product_id INTEGER NOT NULL,
          attribute_name TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
          UNIQUE(product_id, attribute_name)
        )
      `);

      // Create index for dietary attributes
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_dietary_attributes_product ON dietary_attributes(product_id);
      `);

      // Processing log table - audit trail
      db.exec(`
        CREATE TABLE IF NOT EXISTS processing_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          product_code TEXT,
          pdf_file_path TEXT,
          action TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('success', 'error', 'warning')),
          error_message TEXT,
          processing_time_ms INTEGER,
          timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Create index for processing log
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_processing_log_product ON processing_log(product_code);
        CREATE INDEX IF NOT EXISTS idx_processing_log_status ON processing_log(status);
        CREATE INDEX IF NOT EXISTS idx_processing_log_timestamp ON processing_log(timestamp);
      `);

      logger.info('Version 1 migration completed');
    }

    // Version 2: Add dual daily value percentage columns for adult and children
    if (currentVer < 2) {
      logger.info('Applying migration to version 2: Adding dual daily value percentage support...');

      // Create new nutritional_values table with dual DV% columns
      db.exec(`
        CREATE TABLE nutritional_values_v2 (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          supplement_fact_id INTEGER NOT NULL,
          nutrient_name TEXT NOT NULL,
          amount TEXT,
          daily_value_percent_adult TEXT,
          daily_value_percent_children TEXT,
          display_order INTEGER DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (supplement_fact_id) REFERENCES supplement_facts(id) ON DELETE CASCADE,
          CHECK(amount IS NULL OR (amount GLOB '*[0-9]*' AND amount NOT IN ('0', 'unknown', 'N/A')))
        )
      `);

      // Migrate existing data: daily_value_percent → daily_value_percent_adult
      db.exec(`
        INSERT INTO nutritional_values_v2 (
          id, supplement_fact_id, nutrient_name, amount,
          daily_value_percent_adult, daily_value_percent_children,
          display_order, created_at
        )
        SELECT
          id, supplement_fact_id, nutrient_name, amount,
          daily_value_percent, NULL,
          display_order, created_at
        FROM nutritional_values
      `);

      // Drop old table and rename new one
      db.exec('DROP TABLE nutritional_values');
      db.exec('ALTER TABLE nutritional_values_v2 RENAME TO nutritional_values');

      // Recreate index for nutritional values
      db.exec(`
        CREATE INDEX idx_nutritional_values_supplement ON nutritional_values(supplement_fact_id);
      `);

      logger.info('Version 2 migration completed: Dual daily value percentage support added');
    }

    // Version 3: Add verification system tables and columns
    if (currentVer < 3) {
      logger.info('Applying migration to version 3: Adding verification system...');

      // Add new columns to products table
      db.exec(`
        ALTER TABLE products ADD COLUMN id_verification_hash TEXT;
        ALTER TABLE products ADD COLUMN raw_text_extraction TEXT;
      `);

      // Create unique index for id_verification_hash
      db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_products_id_hash ON products(id_verification_hash);
      `);

      // Add confidence columns to nutritional_values
      db.exec(`
        ALTER TABLE nutritional_values ADD COLUMN extraction_confidence REAL DEFAULT 1.0;
        ALTER TABLE nutritional_values ADD COLUMN needs_verification INTEGER DEFAULT 0;
      `);

      // Create verification_extractions table (stores Grok verification data)
      db.exec(`
        CREATE TABLE verification_extractions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          product_id INTEGER NOT NULL UNIQUE,
          raw_grok_response TEXT NOT NULL,
          supplement_facts_data TEXT,
          extraction_time_ms INTEGER,
          model_version TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
        )
      `);

      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_verification_product ON verification_extractions(product_id);
      `);

      // Create extraction_discrepancies table (tracks differences between Claude and Grok)
      db.exec(`
        CREATE TABLE extraction_discrepancies (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          product_id INTEGER NOT NULL,
          field_path TEXT NOT NULL,
          claude_value TEXT,
          grok_value TEXT,
          discrepancy_type TEXT CHECK(discrepancy_type IN ('missing', 'different', 'extra')),
          severity TEXT CHECK(severity IN ('low', 'medium', 'high')),
          confidence_score REAL,
          resolved INTEGER DEFAULT 0,
          resolution_notes TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
        )
      `);

      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_discrepancies_product ON extraction_discrepancies(product_id);
        CREATE INDEX IF NOT EXISTS idx_discrepancies_severity ON extraction_discrepancies(severity, resolved);
      `);

      // Create human_review_queue table (products flagged for manual review)
      db.exec(`
        CREATE TABLE human_review_queue (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          product_id INTEGER NOT NULL UNIQUE,
          product_code TEXT NOT NULL,
          total_discrepancies INTEGER NOT NULL,
          high_severity_count INTEGER NOT NULL,
          medium_severity_count INTEGER NOT NULL,
          review_status TEXT DEFAULT 'pending' CHECK(review_status IN ('pending', 'in_progress', 'resolved', 'dismissed')),
          review_priority INTEGER DEFAULT 0,
          assigned_to TEXT,
          review_notes TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          reviewed_at DATETIME,
          FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
        )
      `);

      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_review_queue_status ON human_review_queue(review_status, review_priority);
      `);

      logger.info('Version 3 migration completed: Verification system added');
    }

    // Version 4: Add validation_error support to extraction_discrepancies
    if (currentVer < 4) {
      logger.info('Applying migration to version 4: Adding validation error support...');

      // SQLite doesn't support modifying CHECK constraints, so we recreate the table
      db.exec(`
        CREATE TABLE extraction_discrepancies_v4 (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          product_id INTEGER NOT NULL,
          field_path TEXT NOT NULL,
          claude_value TEXT,
          grok_value TEXT,
          discrepancy_type TEXT CHECK(discrepancy_type IN ('missing', 'different', 'extra', 'validation_error')),
          severity TEXT CHECK(severity IN ('low', 'medium', 'high')),
          confidence_score REAL,
          resolved INTEGER DEFAULT 0,
          resolution_notes TEXT,
          validation_message TEXT,
          extraction_source TEXT CHECK(extraction_source IS NULL OR extraction_source IN ('claude', 'grok', 'hybrid')),
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
        )
      `);

      // Migrate existing data
      db.exec(`
        INSERT INTO extraction_discrepancies_v4 (
          id, product_id, field_path, claude_value, grok_value,
          discrepancy_type, severity, confidence_score, resolved,
          resolution_notes, validation_message, extraction_source, created_at
        )
        SELECT
          id, product_id, field_path, claude_value, grok_value,
          discrepancy_type, severity, confidence_score, resolved,
          resolution_notes, NULL, NULL, created_at
        FROM extraction_discrepancies
      `);

      // Drop old table and rename new one
      db.exec('DROP TABLE extraction_discrepancies');
      db.exec('ALTER TABLE extraction_discrepancies_v4 RENAME TO extraction_discrepancies');

      // Recreate indexes
      db.exec(`
        CREATE INDEX idx_discrepancies_product ON extraction_discrepancies(product_id);
        CREATE INDEX idx_discrepancies_severity ON extraction_discrepancies(severity, resolved);
        CREATE INDEX idx_discrepancies_type ON extraction_discrepancies(discrepancy_type);
      `);

      logger.info('Version 4 migration completed: Validation error support added');
    }

    // Version 5: Split amount column into unit and amount
    if (currentVer < 5) {
      logger.info('Applying migration to version 5: Splitting amount into unit and amount...');

      // Create new nutritional_values table with separate unit column
      db.exec(`
        CREATE TABLE nutritional_values_v5 (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          supplement_fact_id INTEGER NOT NULL,
          nutrient_name TEXT NOT NULL,
          unit TEXT,
          amount TEXT,
          daily_value_percent_adult TEXT,
          daily_value_percent_children TEXT,
          display_order INTEGER DEFAULT 0,
          extraction_confidence REAL DEFAULT 1.0,
          needs_verification INTEGER DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (supplement_fact_id) REFERENCES supplement_facts(id) ON DELETE CASCADE
        )
      `);

      // Get all existing nutritional values
      const existingValues = db.prepare('SELECT * FROM nutritional_values').all() as Array<{
        id: number;
        supplement_fact_id: number;
        nutrient_name: string;
        amount: string | null;
        daily_value_percent_adult: string | null;
        daily_value_percent_children: string | null;
        display_order: number;
        extraction_confidence: number | null;
        needs_verification: number | null;
        created_at: string;
      }>;

      // Insert statement for new table
      const insertStmt = db.prepare(`
        INSERT INTO nutritional_values_v5 (
          id, supplement_fact_id, nutrient_name, unit, amount,
          daily_value_percent_adult, daily_value_percent_children,
          display_order, extraction_confidence, needs_verification, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      // Regex to parse amount: ^(<?\d+(?:\.\d+)?)\s*(.+)$
      const amountRegex = /^(<?\d+(?:\.\d+)?)\s*(.+)$/;

      for (const row of existingValues) {
        let parsedAmount: string | null = null;
        let parsedUnit: string | null = null;

        if (row.amount) {
          const match = row.amount.match(amountRegex);
          if (match) {
            parsedAmount = match[1]; // e.g., "100", "<1", "2.5"
            parsedUnit = match[2];   // e.g., "mg", "g", "mg RAE"
          } else {
            // If no match, keep original amount, unit stays null
            parsedAmount = row.amount;
          }
        }

        insertStmt.run(
          row.id,
          row.supplement_fact_id,
          row.nutrient_name,
          parsedUnit,
          parsedAmount,
          row.daily_value_percent_adult,
          row.daily_value_percent_children,
          row.display_order,
          row.extraction_confidence ?? 1.0,
          row.needs_verification ?? 0,
          row.created_at
        );
      }

      // Drop old table and rename new one
      db.exec('DROP TABLE nutritional_values');
      db.exec('ALTER TABLE nutritional_values_v5 RENAME TO nutritional_values');

      // Recreate index
      db.exec(`
        CREATE INDEX idx_nutritional_values_supplement ON nutritional_values(supplement_fact_id);
      `);

      logger.info('Version 5 migration completed: Amount split into unit and amount');
    }

    // Update schema version
    if (currentVersion.version === null) {
      db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(SCHEMA_VERSION);
    } else {
      db.prepare('UPDATE schema_version SET version = ?, applied_at = CURRENT_TIMESTAMP WHERE version < ?').run(SCHEMA_VERSION, SCHEMA_VERSION);
    }

    logger.info(`Database schema initialized successfully (version ${SCHEMA_VERSION})`);
  })();
}

// Type definitions for database entities
export interface Product {
  id?: number;
  product_code: string;
  product_name: string;
  product_slogan?: string | null;
  product_description: string;
  product_image_path?: string | null;
  subbrand?: string | null;
  directions: string;
  caution?: string | null;
  references?: string | null;
  pdf_file_path: string;
  folder_path: string;
  extraction_date?: string;
  extraction_status?: 'pending' | 'processing' | 'completed' | 'failed';
  error_message?: string | null;
  raw_ai_response?: string | null;
  id_verification_hash?: string | null;
  raw_text_extraction?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface SupplementFact {
  id?: number;
  product_id: number;
  servings: string;
  servings_per_container: string;
  calories?: string | null;
  protein?: string | null;
  created_at?: string;
}

export interface NutritionalValue {
  id?: number;
  supplement_fact_id: number;
  nutrient_name: string;
  unit: string | null;
  amount: string | null;
  daily_value_percent_adult?: string | null;
  daily_value_percent_children?: string | null;
  display_order?: number;
  extraction_confidence?: number;
  needs_verification?: number;
  created_at?: string;
}

export interface Ingredient {
  id?: number;
  product_id: number;
  ingredient_name: string;
  is_organic: boolean;
  display_order?: number;
  created_at?: string;
}

export interface DietaryAttribute {
  id?: number;
  product_id: number;
  attribute_name: string;
  created_at?: string;
}

export interface ProcessingLog {
  id?: number;
  product_code?: string | null;
  pdf_file_path?: string | null;
  action: string;
  status: 'success' | 'error' | 'warning';
  error_message?: string | null;
  processing_time_ms?: number | null;
  timestamp?: string;
}

export interface VerificationExtraction {
  id?: number;
  product_id: number;
  raw_grok_response: string;
  supplement_facts_data?: string | null;
  extraction_time_ms?: number | null;
  model_version?: string | null;
  created_at?: string;
}

export interface ExtractionDiscrepancy {
  id?: number;
  product_id: number;
  field_path: string;
  claude_value?: string | null;
  grok_value?: string | null;
  discrepancy_type: 'missing' | 'different' | 'extra' | 'validation_error';
  severity: 'low' | 'medium' | 'high';
  confidence_score?: number | null;
  resolved?: number;
  resolution_notes?: string | null;
  validation_message?: string | null;
  extraction_source?: 'claude' | 'grok' | 'hybrid' | null;
  created_at?: string;
}

export interface HumanReviewQueue {
  id?: number;
  product_id: number;
  product_code: string;
  total_discrepancies: number;
  high_severity_count: number;
  medium_severity_count: number;
  review_status?: 'pending' | 'in_progress' | 'resolved' | 'dismissed';
  review_priority?: number;
  assigned_to?: string | null;
  review_notes?: string | null;
  created_at?: string;
  reviewed_at?: string | null;
}
