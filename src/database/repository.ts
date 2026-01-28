import Database from 'better-sqlite3';
import { getDatabase } from '../config/database.js';
import {
  Product,
  SupplementFact,
  NutritionalValue,
  Ingredient,
  DietaryAttribute,
  ProcessingLog,
  ExtractionDiscrepancy,
  HumanReviewQueue,
} from './schema.js';
import { ProductExtractionData, SupplementFactsData } from '../parser/json-validator.js';
import { PDFFileMetadata } from '../scanner/file-parser.js';
import { Discrepancy } from '../verification/comparison-engine.js';
import { ValidationWarning } from '../extractor/ai-extractor.js';
import logger from '../utils/logger.js';
import crypto from 'crypto';

export interface VerificationData {
  rawResponse: string;
  supplementFacts?: SupplementFactsData;
  extractionTimeMs?: number;
  modelVersion?: string;
}

export class ProductRepository {
  private db: Database.Database;

  constructor() {
    this.db = getDatabase();
  }

  // Insert complete product with all related data
  insertProduct(
    metadata: PDFFileMetadata,
    extractionData: ProductExtractionData,
    rawResponse: string,
    verificationData?: VerificationData
  ): number {
    return this.db.transaction(() => {
      // Generate deterministic hash for ID tracking
      const idHash = this.generateIdHash(metadata.productCode, metadata.filePath);

      // Insert or update main product
      const productId = this.insertProductData(metadata, extractionData, rawResponse, idHash);

      // Delete existing related records (for re-extraction scenarios)
      this.deleteRelatedData(productId);

      // Insert supplement facts if present with EXPLICIT ID = productId
      if (extractionData.supplementFacts && productId) {
        this.insertSupplementFactsWithExplicitId(
          productId,
          extractionData.supplementFacts
        );
      }

      // Insert ingredients
      if (extractionData.ingredients && extractionData.ingredients.length > 0) {
        this.insertIngredients(productId, extractionData.ingredients);
      }

      // Insert dietary attributes
      if (extractionData.dietaryAttributes && extractionData.dietaryAttributes.length > 0) {
        this.insertDietaryAttributes(productId, extractionData.dietaryAttributes);
      }

      // Insert verification data if provided
      if (verificationData) {
        this.insertVerificationData(productId, verificationData);
      }

      logger.info(`Inserted/updated product ${metadata.productCode} with ID ${productId}`);
      return productId;
    })();
  }

  // Generate deterministic ID hash
  private generateIdHash(productCode: string, filePath: string): string {
    const hashInput = `${productCode}::${filePath}`;
    return crypto.createHash('sha256').update(hashInput).digest('hex');
  }

  // Delete all related data for a product
  private deleteRelatedData(productId: number): void {
    // Order matters due to foreign key constraints
    this.db.prepare('DELETE FROM dietary_attributes WHERE product_id = ?').run(productId);
    this.db.prepare('DELETE FROM ingredients WHERE product_id = ?').run(productId);

    // Delete nutritional values first (has FK to supplement_facts)
    this.db.prepare(`
      DELETE FROM nutritional_values
      WHERE supplement_fact_id IN (
        SELECT id FROM supplement_facts WHERE product_id = ?
      )
    `).run(productId);
    this.db.prepare('DELETE FROM supplement_facts WHERE product_id = ?').run(productId);

    // Delete verification data
    this.db.prepare('DELETE FROM verification_extractions WHERE product_id = ?').run(productId);
    this.db.prepare('DELETE FROM extraction_discrepancies WHERE product_id = ?').run(productId);
    this.db.prepare('DELETE FROM human_review_queue WHERE product_id = ?').run(productId);
  }

  private insertProductData(
    metadata: PDFFileMetadata,
    data: ProductExtractionData,
    rawResponse: string,
    idHash: string
  ): number {
    const stmt = this.db.prepare(`
      INSERT INTO products (
        product_code, product_name, product_slogan, product_description,
        subbrand, directions, caution, "references",
        pdf_file_path, folder_path, extraction_status, raw_ai_response,
        id_verification_hash, raw_text_extraction
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(product_code) DO UPDATE SET
        product_name = excluded.product_name,
        product_slogan = excluded.product_slogan,
        product_description = excluded.product_description,
        subbrand = excluded.subbrand,
        directions = excluded.directions,
        caution = excluded.caution,
        "references" = excluded."references",
        pdf_file_path = excluded.pdf_file_path,
        folder_path = excluded.folder_path,
        extraction_status = excluded.extraction_status,
        raw_ai_response = excluded.raw_ai_response,
        id_verification_hash = excluded.id_verification_hash,
        raw_text_extraction = excluded.raw_text_extraction,
        updated_at = CURRENT_TIMESTAMP
    `);

    stmt.run(
      metadata.productCode,
      data.productName,
      data.productSlogan || null,
      data.productDescription,
      data.subbrand || metadata.subbrand || null,
      data.directions,
      data.caution || null,
      data.references || null,
      metadata.filePath,
      metadata.folderPath,
      'completed',
      rawResponse,
      idHash,
      null // raw_text_extraction - can be added later if needed
    );

    // Get the product ID (either newly inserted or existing)
    const product = this.db
      .prepare('SELECT id FROM products WHERE product_code = ?')
      .get(metadata.productCode) as { id: number };

    return product.id;
  }

  // Insert supplement facts with explicit ID = productId (ensures ID alignment)
  private insertSupplementFactsWithExplicitId(
    productId: number,
    supplementFacts: NonNullable<ProductExtractionData['supplementFacts']>
  ): void {
    // CRITICAL: Set supplement_facts.id = productId explicitly
    const stmt = this.db.prepare(`
      INSERT INTO supplement_facts (
        id, product_id, servings, servings_per_container, calories, protein
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      productId, // Explicit ID assignment - ensures alignment
      productId,
      supplementFacts.servings,
      supplementFacts.servingsPerContainer,
      supplementFacts.calories || null,
      supplementFacts.protein || null
    );

    // Insert nutritional values
    if (supplementFacts.nutrients && supplementFacts.nutrients.length > 0) {
      this.insertNutritionalValues(productId, supplementFacts.nutrients);
    }
  }

  // Helper to parse combined amount string into separate unit and amount
  private parseAmountUnit(combinedAmount: string | null | undefined): { amount: string | null; unit: string | null } {
    if (!combinedAmount) {
      return { amount: null, unit: null };
    }

    // Regex: ^(<?\d+(?:\.\d+)?)\s*(.+)$
    // Matches: "100 mg", "<1 g", "2.5 g", "500 mg RAE", "2 gummy bears"
    const amountRegex = /^(<?\d+(?:\.\d+)?)\s*(.+)$/;
    const match = combinedAmount.match(amountRegex);

    if (match) {
      return {
        amount: match[1], // e.g., "100", "<1", "2.5"
        unit: match[2]    // e.g., "mg", "g", "mg RAE"
      };
    }

    // If no match, return original as amount with null unit
    return { amount: combinedAmount, unit: null };
  }

  private insertNutritionalValues(
    supplementFactId: number,
    nutrients: NonNullable<ProductExtractionData['supplementFacts']>['nutrients']
  ): void {
    const stmt = this.db.prepare(`
      INSERT INTO nutritional_values (
        supplement_fact_id, nutrient_name, unit, amount,
        daily_value_percent_adult, daily_value_percent_children, display_order
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    nutrients.forEach((nutrient, index) => {
      const { amount, unit } = this.parseAmountUnit(nutrient.amount);
      stmt.run(
        supplementFactId,
        nutrient.name,
        unit,
        amount,
        nutrient.dailyValuePercentAdult || null,
        nutrient.dailyValuePercentChildren || null,
        index
      );
    });
  }

  private insertIngredients(
    productId: number,
    ingredients: NonNullable<ProductExtractionData['ingredients']>
  ): void {
    const stmt = this.db.prepare(`
      INSERT INTO ingredients (
        product_id, ingredient_name, is_organic, display_order
      ) VALUES (?, ?, ?, ?)
    `);

    ingredients.forEach((ingredient, index) => {
      stmt.run(
        productId,
        ingredient.name,
        ingredient.isOrganic ? 1 : 0,
        index
      );
    });
  }

  private insertDietaryAttributes(productId: number, attributes: string[]): void {
    const stmt = this.db.prepare(`
      INSERT INTO dietary_attributes (product_id, attribute_name)
      VALUES (?, ?)
    `);

    attributes.forEach((attribute) => {
      try {
        stmt.run(productId, attribute);
      } catch (error) {
        // Ignore duplicate attribute errors
        logger.debug(`Duplicate dietary attribute: ${attribute}`);
      }
    });
  }

  // Mark product as failed
  markProductAsFailed(
    metadata: PDFFileMetadata,
    errorMessage: string,
    rawResponse?: string
  ): void {
    const stmt = this.db.prepare(`
      INSERT INTO products (
        product_code, product_name, pdf_file_path, folder_path,
        extraction_status, error_message, raw_ai_response, subbrand
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(product_code) DO UPDATE SET
        extraction_status = 'failed',
        error_message = excluded.error_message,
        raw_ai_response = excluded.raw_ai_response,
        updated_at = CURRENT_TIMESTAMP
    `);

    stmt.run(
      metadata.productCode,
      metadata.productName,
      metadata.filePath,
      metadata.folderPath,
      'failed',
      errorMessage,
      rawResponse || null,
      metadata.subbrand || null
    );
  }

  // Check if product already processed
  isProductProcessed(productCode: string): boolean {
    const stmt = this.db.prepare(
      'SELECT id FROM products WHERE product_code = ? AND extraction_status = ?'
    );
    const result = stmt.get(productCode, 'completed');
    return result !== undefined;
  }

  // Get failed products
  getFailedProducts(): Product[] {
    const stmt = this.db.prepare(
      'SELECT * FROM products WHERE extraction_status = ? ORDER BY product_code'
    );
    return stmt.all('failed') as Product[];
  }

  // Get all products
  getAllProducts(): Product[] {
    const stmt = this.db.prepare('SELECT * FROM products ORDER BY product_code');
    return stmt.all() as Product[];
  }

  // Get product with all related data
  getProductWithDetails(productCode: string): {
    product: Product | null;
    supplementFacts: SupplementFact | null;
    nutrients: NutritionalValue[];
    ingredients: Ingredient[];
    dietaryAttributes: DietaryAttribute[];
  } | null {
    const product = this.db
      .prepare('SELECT * FROM products WHERE product_code = ?')
      .get(productCode) as Product | undefined;

    if (!product) {
      return null;
    }

    const supplementFacts = this.db
      .prepare('SELECT * FROM supplement_facts WHERE product_id = ?')
      .get(product.id) as SupplementFact | undefined;

    const nutrients = supplementFacts
      ? (this.db
          .prepare(
            'SELECT * FROM nutritional_values WHERE supplement_fact_id = ? ORDER BY display_order'
          )
          .all(supplementFacts.id) as NutritionalValue[])
      : [];

    const ingredients = this.db
      .prepare('SELECT * FROM ingredients WHERE product_id = ? ORDER BY display_order')
      .all(product.id) as Ingredient[];

    const dietaryAttributes = this.db
      .prepare('SELECT * FROM dietary_attributes WHERE product_id = ?')
      .all(product.id) as DietaryAttribute[];

    return {
      product,
      supplementFacts: supplementFacts || null,
      nutrients,
      ingredients,
      dietaryAttributes,
    };
  }

  // Log processing action
  logProcessing(log: Omit<ProcessingLog, 'id' | 'timestamp'>): void {
    const stmt = this.db.prepare(`
      INSERT INTO processing_log (
        product_code, pdf_file_path, action, status, error_message, processing_time_ms
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      log.product_code || null,
      log.pdf_file_path || null,
      log.action,
      log.status,
      log.error_message || null,
      log.processing_time_ms || null
    );
  }

  // Get processing statistics
  getStatistics(): {
    total: number;
    completed: number;
    failed: number;
    pending: number;
    successRate: number;
  } {
    const stats = this.db
      .prepare(
        `
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN extraction_status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN extraction_status = 'failed' THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN extraction_status = 'pending' THEN 1 ELSE 0 END) as pending
      FROM products
    `
      )
      .get() as { total: number; completed: number; failed: number; pending: number };

    return {
      ...stats,
      successRate: stats.total > 0 ? (stats.completed / stats.total) * 100 : 0,
    };
  }

  // Get data completeness report
  getCompletenessReport(): {
    totalProducts: number;
    withSupplementFacts: number;
    withIngredients: number;
    withDietaryAttributes: number;
    avgIngredientsPerProduct: number;
  } {
    const report = this.db
      .prepare(
        `
      SELECT
        COUNT(DISTINCT p.id) as totalProducts,
        COUNT(DISTINCT sf.id) as withSupplementFacts,
        COUNT(DISTINCT CASE WHEN i.id IS NOT NULL THEN p.id END) as withIngredients,
        COUNT(DISTINCT CASE WHEN da.id IS NOT NULL THEN p.id END) as withDietaryAttributes,
        CAST(COUNT(i.id) AS FLOAT) / NULLIF(COUNT(DISTINCT p.id), 0) as avgIngredientsPerProduct
      FROM products p
      LEFT JOIN supplement_facts sf ON p.id = sf.product_id
      LEFT JOIN ingredients i ON p.id = i.product_id
      LEFT JOIN dietary_attributes da ON p.id = da.product_id
      WHERE p.extraction_status = 'completed'
    `
      )
      .get() as {
      totalProducts: number;
      withSupplementFacts: number;
      withIngredients: number;
      withDietaryAttributes: number;
      avgIngredientsPerProduct: number;
    };

    return report;
  }

  // ===== VERIFICATION METHODS =====

  // Insert Grok verification data
  insertVerificationData(productId: number, data: VerificationData): void {
    const stmt = this.db.prepare(`
      INSERT INTO verification_extractions (
        product_id, raw_grok_response, supplement_facts_data,
        extraction_time_ms, model_version
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(product_id) DO UPDATE SET
        raw_grok_response = excluded.raw_grok_response,
        supplement_facts_data = excluded.supplement_facts_data,
        extraction_time_ms = excluded.extraction_time_ms,
        model_version = excluded.model_version,
        created_at = CURRENT_TIMESTAMP
    `);

    stmt.run(
      productId,
      data.rawResponse,
      data.supplementFacts ? JSON.stringify(data.supplementFacts) : null,
      data.extractionTimeMs || null,
      data.modelVersion || 'grok-2-vision-1212'
    );
  }

  // Insert discrepancies between Claude and Grok
  insertDiscrepancies(productId: number, discrepancies: Discrepancy[]): void {
    // First delete existing non-validation discrepancies for this product
    this.db.prepare("DELETE FROM extraction_discrepancies WHERE product_id = ? AND discrepancy_type != 'validation_error'").run(productId);

    if (discrepancies.length === 0) return;

    const stmt = this.db.prepare(`
      INSERT INTO extraction_discrepancies (
        product_id, field_path, claude_value, grok_value,
        discrepancy_type, severity, confidence_score
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    discrepancies.forEach(d => {
      stmt.run(
        productId,
        d.fieldPath,
        JSON.stringify(d.claudeValue),
        JSON.stringify(d.grokValue),
        d.type,
        d.severity,
        d.confidenceScore
      );
    });
  }

  // Insert validation warnings as discrepancies
  insertValidationWarnings(
    productId: number,
    warnings: ValidationWarning[],
    extractionSource: 'claude' | 'grok' | 'hybrid'
  ): void {
    // First delete existing validation_error discrepancies for this product
    this.db.prepare("DELETE FROM extraction_discrepancies WHERE product_id = ? AND discrepancy_type = 'validation_error'").run(productId);

    if (warnings.length === 0) return;

    const stmt = this.db.prepare(`
      INSERT INTO extraction_discrepancies (
        product_id, field_path, discrepancy_type, severity,
        validation_message, extraction_source
      ) VALUES (?, ?, 'validation_error', ?, ?, ?)
    `);

    warnings.forEach(w => {
      stmt.run(
        productId,
        w.fieldPath,
        w.severity,
        w.message,
        extractionSource
      );
    });

    logger.info(`Inserted ${warnings.length} validation warnings for product ${productId}`);
  }

  // Add product to human review queue
  addToReviewQueue(
    productId: number,
    productCode: string,
    discrepancies: Discrepancy[],
    validationWarnings?: ValidationWarning[]
  ): void {
    const comparisonHighCount = discrepancies.filter(d => d.severity === 'high').length;
    const comparisonMediumCount = discrepancies.filter(d => d.severity === 'medium').length;

    const validationHighCount = (validationWarnings || []).filter(w => w.severity === 'high').length;
    const validationMediumCount = (validationWarnings || []).filter(w => w.severity === 'medium').length;

    // Total counts
    const totalHighCount = comparisonHighCount + validationHighCount;
    const totalMediumCount = comparisonMediumCount + validationMediumCount;
    const totalDiscrepancies = discrepancies.length + (validationWarnings || []).length;

    // Priority formula: validation errors weighted higher (3x) than comparison discrepancies (2x)
    // because they indicate persistent data quality issues
    const priority = (validationHighCount * 3) + (comparisonHighCount * 2) + totalMediumCount;

    const stmt = this.db.prepare(`
      INSERT INTO human_review_queue (
        product_id, product_code, total_discrepancies,
        high_severity_count, medium_severity_count, review_priority
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(product_id) DO UPDATE SET
        total_discrepancies = excluded.total_discrepancies,
        high_severity_count = excluded.high_severity_count,
        medium_severity_count = excluded.medium_severity_count,
        review_priority = excluded.review_priority,
        created_at = CURRENT_TIMESTAMP
    `);

    stmt.run(
      productId,
      productCode,
      totalDiscrepancies,
      totalHighCount,
      totalMediumCount,
      priority
    );
  }

  // Get review queue items
  getReviewQueue(status?: string): HumanReviewQueue[] {
    const query = status
      ? 'SELECT * FROM human_review_queue WHERE review_status = ? ORDER BY review_priority DESC, created_at ASC'
      : 'SELECT * FROM human_review_queue ORDER BY review_priority DESC, created_at ASC';

    const stmt = status ? this.db.prepare(query).all(status) : this.db.prepare(query).all();
    return stmt as HumanReviewQueue[];
  }

  // Get discrepancies for a product
  getDiscrepanciesForProduct(productId: number): ExtractionDiscrepancy[] {
    const stmt = this.db.prepare(`
      SELECT * FROM extraction_discrepancies
      WHERE product_id = ?
      ORDER BY severity DESC, field_path ASC
    `);

    return stmt.all(productId) as ExtractionDiscrepancy[];
  }

  // Get product by code
  getProductByCode(productCode: string): Product | null {
    const stmt = this.db.prepare('SELECT * FROM products WHERE product_code = ?');
    const result = stmt.get(productCode);
    return result ? (result as Product) : null;
  }

  // Mark review as resolved
  markReviewResolved(productId: number, notes: string): void {
    const stmt = this.db.prepare(`
      UPDATE human_review_queue
      SET review_status = 'resolved',
          review_notes = ?,
          reviewed_at = CURRENT_TIMESTAMP
      WHERE product_id = ?
    `);

    stmt.run(notes, productId);
  }

  // Get comparison statistics
  getComparisonStatistics(): {
    totalCompared: number;
    averageSimilarity: number;
    highDiscrepancyCount: number;
    pendingReviewCount: number;
  } {
    const totalCompared = this.db
      .prepare('SELECT COUNT(*) as count FROM verification_extractions')
      .get() as { count: number };

    const pendingReviews = this.db
      .prepare("SELECT COUNT(*) as count FROM human_review_queue WHERE review_status = 'pending'")
      .get() as { count: number };

    const highDiscrepancies = this.db
      .prepare("SELECT COUNT(DISTINCT product_id) as count FROM extraction_discrepancies WHERE severity = 'high'")
      .get() as { count: number };

    return {
      totalCompared: totalCompared.count,
      averageSimilarity: 0, // TODO: Calculate from comparison results
      highDiscrepancyCount: highDiscrepancies.count,
      pendingReviewCount: pendingReviews.count
    };
  }

  // Export comparison report to CSV
  async exportComparisonReport(outputPath: string): Promise<void> {
    // TODO: Implement CSV export of comparison data
    logger.info(`Export comparison report to ${outputPath} - not yet implemented`);
  }
}
