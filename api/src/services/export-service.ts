import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, '../../../products.db');

// Table definitions with columns to export (excluding large blob columns)
export const TABLE_SCHEMAS: Record<string, string[]> = {
  products: [
    'id', 'product_code', 'product_name', 'product_slogan', 'product_description',
    'product_image_path', 'subbrand', 'directions', 'caution', 'references',
    'pdf_file_path', 'folder_path', 'extraction_date', 'extraction_status',
    'error_message', 'created_at', 'updated_at', 'id_verification_hash'
    // Excluded: raw_ai_response, raw_text_extraction (large blobs)
  ],
  supplement_facts: [
    'id', 'product_id', 'servings', 'servings_per_container', 'calories', 'protein', 'created_at'
  ],
  nutritional_values: [
    'id', 'supplement_fact_id', 'nutrient_name', 'unit', 'amount',
    'daily_value_percent_adult', 'daily_value_percent_children', 'display_order',
    'extraction_confidence', 'needs_verification', 'created_at'
  ],
  ingredients: [
    'id', 'product_id', 'ingredient_name', 'is_organic', 'display_order', 'created_at'
  ],
  dietary_attributes: [
    'id', 'product_id', 'attribute_name', 'created_at'
  ],
  processing_log: [
    'id', 'product_code', 'pdf_file_path', 'action', 'status',
    'error_message', 'processing_time_ms', 'timestamp'
  ],
  verification_extractions: [
    'id', 'product_id', 'supplement_facts_data', 'extraction_time_ms',
    'model_version', 'created_at'
    // Excluded: raw_grok_response (large blob)
  ],
  extraction_discrepancies: [
    'id', 'product_id', 'field_path', 'claude_value', 'grok_value',
    'discrepancy_type', 'severity', 'confidence_score', 'resolved',
    'resolution_notes', 'validation_message', 'extraction_source', 'created_at'
  ],
  human_review_queue: [
    'id', 'product_id', 'product_code', 'total_discrepancies', 'high_severity_count',
    'medium_severity_count', 'review_status', 'review_priority', 'assigned_to',
    'review_notes', 'created_at', 'reviewed_at'
  ],
  schema_version: [
    'version', 'applied_at'
  ]
};

export function getExportDb(): Database.Database {
  return new Database(DB_PATH, { readonly: true });
}

export function* iterateTable(db: Database.Database, tableName: string): Generator<Record<string, unknown>> {
  const columns = TABLE_SCHEMAS[tableName];
  if (!columns) {
    throw new Error(`Unknown table: ${tableName}`);
  }

  const quotedColumns = columns.map(col => col === 'references' ? '`references`' : col);
  const stmt = db.prepare(`SELECT ${quotedColumns.join(', ')} FROM ${tableName}`);

  for (const row of stmt.iterate()) {
    yield row as Record<string, unknown>;
  }
}

export function getTableNames(): string[] {
  return Object.keys(TABLE_SCHEMAS);
}

export function getTableColumns(tableName: string): string[] {
  return TABLE_SCHEMAS[tableName] || [];
}
