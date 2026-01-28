-- Database ID Alignment Migration
-- Purpose: Align supplement_facts.id with products.id
-- Date: 2026-01-21
--
-- This migration fixes the ID misalignment issue where supplement_facts IDs
-- do not match their corresponding product IDs. After this migration,
-- supplement_facts.id will equal products.id for all products.

-- Disable foreign key constraints temporarily
PRAGMA foreign_keys = OFF;

-- Step 1: Create mapping of old supplement_facts ID → new ID (product_id)
CREATE TEMP TABLE id_mapping AS
SELECT
  sf.id as old_id,
  sf.product_id as new_id
FROM supplement_facts sf;

-- Step 2: Create new supplement_facts table with realigned IDs
CREATE TABLE supplement_facts_new (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL UNIQUE,
  servings TEXT,
  servings_per_container TEXT,
  calories TEXT,
  protein TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

-- Step 3: Copy data with new IDs (id = product_id)
INSERT INTO supplement_facts_new (id, product_id, servings, servings_per_container, calories, protein, created_at)
SELECT product_id, product_id, servings, servings_per_container, calories, protein, created_at
FROM supplement_facts;

-- Step 4: Create new nutritional_values table with updated foreign keys
CREATE TABLE nutritional_values_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplement_fact_id INTEGER NOT NULL,
  nutrient_name TEXT NOT NULL,
  amount TEXT,
  daily_value_percent_adult TEXT,
  daily_value_percent_children TEXT,
  display_order INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (supplement_fact_id) REFERENCES supplement_facts(id) ON DELETE CASCADE
);

-- Step 5: Copy nutritional values with remapped supplement_fact_id
INSERT INTO nutritional_values_new
  (supplement_fact_id, nutrient_name, amount, daily_value_percent_adult,
   daily_value_percent_children, display_order, created_at)
SELECT
  m.new_id,
  nv.nutrient_name,
  nv.amount,
  nv.daily_value_percent_adult,
  nv.daily_value_percent_children,
  nv.display_order,
  nv.created_at
FROM nutritional_values nv
JOIN id_mapping m ON nv.supplement_fact_id = m.old_id;

-- Step 6: Replace old tables with new ones
DROP TABLE nutritional_values;
DROP TABLE supplement_facts;
ALTER TABLE supplement_facts_new RENAME TO supplement_facts;
ALTER TABLE nutritional_values_new RENAME TO nutritional_values;

-- Step 7: Recreate indexes for performance
CREATE INDEX idx_nutritional_values_supplement ON nutritional_values(supplement_fact_id);

-- Step 8: Clean up temporary tables
DROP TABLE IF EXISTS id_mapping;

-- Re-enable foreign key constraints
PRAGMA foreign_keys = ON;

-- Verification queries (commented out, will be run by migration runner)
-- SELECT COUNT(*) FROM products;
-- SELECT COUNT(*) FROM supplement_facts;
-- SELECT COUNT(*) FROM nutritional_values;
-- SELECT COUNT(*) FROM products p JOIN supplement_facts sf ON p.id = sf.id WHERE p.id = sf.id;
