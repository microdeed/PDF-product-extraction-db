import { scanPDFDirectory } from '../scanner/pdf-scanner.js';
import { PDFFileMetadata } from '../scanner/file-parser.js';
import { AIExtractor } from '../extractor/ai-extractor.js';
import { GrokExtractor } from '../extractor/grok-extractor.js';
import { ComparisonEngine } from '../verification/comparison-engine.js';
import { ProductRepository } from '../database/repository.js';
import { ErrorHandler, ShutdownHandler } from './error-handler.js';
import { ProgressTracker } from '../utils/progress-tracker.js';
import { checkDataCompleteness } from '../parser/data-normalizer.js';
import logger, { logProcessingStart, logProcessingComplete } from '../utils/logger.js';
import { env } from '../config/env.js';

export interface ProcessingOptions {
  skipExisting?: boolean;
  concurrency?: number;
  retryFailed?: boolean;
  limit?: number; // Maximum number of PDFs to process
}

export interface ProcessingResult {
  totalProcessed: number;
  successCount: number;
  failureCount: number;
  skippedCount: number;
  elapsedMs: number;
  successRate: number;
}

export class BatchProcessor {
  private extractor: AIExtractor;
  private repository: ProductRepository;
  private errorHandler: ErrorHandler;
  private shutdownHandler: ShutdownHandler;

  constructor() {
    this.extractor = new AIExtractor();
    this.repository = new ProductRepository();
    this.errorHandler = new ErrorHandler();
    this.shutdownHandler = new ShutdownHandler();
  }

  // Process all PDFs in directory
  async processAll(options: ProcessingOptions = {}): Promise<ProcessingResult> {
    const startTime = Date.now();
    const concurrency = options.concurrency || env.CONCURRENT_PROCESSES;
    const skipExisting = options.skipExisting ?? true;
    const limit = options.limit;

    logger.info('Starting batch processing...');
    logger.info(`Configuration: concurrency=${concurrency}, skipExisting=${skipExisting}${limit ? `, limit=${limit}` : ''}`);

    // Scan directory
    const scanResult = await scanPDFDirectory();
    logger.info(
      `Scan complete: ${scanResult.validFiles} valid PDFs found, ${scanResult.invalidFiles} invalid`
    );

    if (scanResult.validFiles === 0) {
      logger.warn('No valid PDFs found to process');
      return {
        totalProcessed: 0,
        successCount: 0,
        failureCount: 0,
        skippedCount: 0,
        elapsedMs: Date.now() - startTime,
        successRate: 0,
      };
    }

    // Filter PDFs (skip already processed)
    let pdfsToProcess = skipExisting
      ? scanResult.metadata.filter((pdf) => !this.repository.isProductProcessed(pdf.productCode))
      : scanResult.metadata;

    const skippedCount = scanResult.metadata.length - pdfsToProcess.length;

    if (skippedCount > 0) {
      logger.info(`Skipping ${skippedCount} already processed PDFs`);
    }

    // Apply limit if specified
    if (limit && limit > 0 && pdfsToProcess.length > limit) {
      logger.info(`Limiting processing to first ${limit} PDFs (${pdfsToProcess.length} available)`);
      pdfsToProcess = pdfsToProcess.slice(0, limit);
    }

    if (pdfsToProcess.length === 0) {
      logger.info('All PDFs already processed');
      return {
        totalProcessed: 0,
        successCount: 0,
        failureCount: 0,
        skippedCount,
        elapsedMs: Date.now() - startTime,
        successRate: 100,
      };
    }

    logProcessingStart(pdfsToProcess.length);

    // Initialize progress tracker
    const progress = new ProgressTracker(pdfsToProcess.length);

    // Process PDFs with concurrency control
    let successCount = 0;
    let failureCount = 0;

    for (let i = 0; i < pdfsToProcess.length; i += concurrency) {
      // Check for shutdown
      if (this.shutdownHandler.isShuttingDownNow()) {
        logger.warn('Shutdown requested, stopping processing');
        break;
      }

      const batch = pdfsToProcess.slice(i, i + concurrency);
      const batchPromises = batch.map((pdf) => this.processSinglePDF(pdf, progress));

      const results = await Promise.allSettled(batchPromises);

      // Count results
      for (const result of results) {
        if (result.status === 'fulfilled' && result.value) {
          successCount++;
        } else {
          failureCount++;
        }
      }
    }

    const elapsedMs = Date.now() - startTime;
    const successRate = (successCount / (successCount + failureCount)) * 100;

    logProcessingComplete(successCount, failureCount, elapsedMs);

    // Log final summary
    const summary = progress.getSummary();
    logger.info('\n' + '='.repeat(70));
    logger.info('PROCESSING COMPLETE');
    logger.info(`Total: ${summary.total} | Success: ${summary.completed} | Failed: ${summary.failed}`);
    logger.info(`Success Rate: ${summary.successRate.toFixed(2)}%`);
    logger.info(`Elapsed Time: ${this.formatDuration(summary.elapsedMs)}`);
    logger.info('='.repeat(70) + '\n');

    return {
      totalProcessed: successCount + failureCount,
      successCount,
      failureCount,
      skippedCount,
      elapsedMs,
      successRate,
    };
  }

  // Process a single PDF
  private async processSinglePDF(
    metadata: PDFFileMetadata,
    progress: ProgressTracker
  ): Promise<boolean> {
    const startTime = Date.now();

    try {
      progress.start(metadata.productCode);

      // Step 1: Extract data with retry logic (use hybrid extraction if enabled)
      const extractionResult = await this.errorHandler.withRetry(
        () => env.ENABLE_HYBRID_EXTRACTION
          ? this.extractor.extractProductInfoHybrid(metadata)
          : this.extractor.extractProductInfo(metadata),
        `Extract ${metadata.productCode}`
      );

      if (!extractionResult.success || !extractionResult.data) {
        // Mark as failed
        this.repository.markProductAsFailed(
          metadata,
          extractionResult.error || 'Extraction failed',
          extractionResult.rawResponse
        );

        this.repository.logProcessing({
          product_code: metadata.productCode,
          pdf_file_path: metadata.filePath,
          action: 'extract',
          status: 'error',
          error_message: extractionResult.error,
          processing_time_ms: extractionResult.processingTimeMs,
        });

        logger.error(`Failed to extract ${metadata.productCode}: ${extractionResult.error}`);
        progress.complete(false);
        return false;
      }

      // Step 2: Grok verification (supplement facts only) if enabled
      let grokResult = null;
      let comparisonResult = null;

      if (env.ENABLE_GROK_VERIFICATION && extractionResult.data.supplementFacts) {
        try {
          const grokExtractor = new GrokExtractor();
          grokResult = await grokExtractor.verifySupplementFacts(metadata);

          // Step 3: Compare supplement facts if Grok succeeded
          if (grokResult.success && grokResult.supplementFacts) {
            const comparisonEngine = new ComparisonEngine();
            comparisonResult = comparisonEngine.compareSupplementFacts(
              extractionResult.data.supplementFacts,
              grokResult.supplementFacts
            );

            // Log comparison results
            logger.info(
              `Comparison for ${metadata.productCode}: ` +
              `Similarity ${comparisonResult.similarityScore.toFixed(1)}%, ` +
              `${comparisonResult.discrepancies.length} discrepancies`
            );

            // Flag for review if needed
            if (comparisonResult.recommendsReview) {
              logger.warn(
                `Product ${metadata.productCode} flagged for review: ` +
                `${comparisonResult.discrepancies.filter(d => d.severity === 'high').length} high-severity issues`
              );
            }
          }
        } catch (error) {
          logger.warn(`Grok verification failed for ${metadata.productCode}: ${error instanceof Error ? error.message : 'Unknown error'}`);
          // Continue with Claude-only extraction
        }
      }

      // Check data completeness
      const completeness = checkDataCompleteness(extractionResult.data);
      if (completeness.completenessPercent < 50) {
        logger.warn(
          `Low data completeness for ${metadata.productCode}: ${completeness.completenessPercent}%`
        );
      }

      // Step 4: Insert into database with verification data
      const productId = this.repository.insertProduct(
        metadata,
        extractionResult.data,
        extractionResult.rawResponse || '',
        grokResult?.success ? {
          rawResponse: grokResult.rawResponse || '',
          supplementFacts: grokResult.supplementFacts,
          extractionTimeMs: grokResult.extractionTimeMs,
          modelVersion: env.GROK_MODEL
        } : undefined
      );

      // Step 5: Insert validation warnings if any
      const validationWarnings = extractionResult.validationWarnings || [];
      if (validationWarnings.length > 0) {
        const source = env.ENABLE_HYBRID_EXTRACTION ? 'hybrid' : 'claude';
        this.repository.insertValidationWarnings(productId, validationWarnings, source);
      }

      // Step 6: Insert discrepancies and add to review queue
      if (comparisonResult && comparisonResult.hasDiscrepancies) {
        this.repository.insertDiscrepancies(productId, comparisonResult.discrepancies);
      }

      // Step 7: Determine if product needs review
      // Review needed if:
      // - Comparison recommends review, OR
      // - Any high-severity validation warnings, OR
      // - More than 2 medium-severity validation warnings
      const needsReview =
        (comparisonResult?.recommendsReview) ||
        validationWarnings.some(w => w.severity === 'high') ||
        validationWarnings.filter(w => w.severity === 'medium').length > 2;

      if (needsReview) {
        const discrepancies = comparisonResult?.discrepancies || [];
        this.repository.addToReviewQueue(
          productId,
          metadata.productCode,
          discrepancies,
          validationWarnings
        );

        if (validationWarnings.length > 0) {
          const highCount = validationWarnings.filter(w => w.severity === 'high').length;
          logger.warn(
            `Product ${metadata.productCode} flagged for review: ` +
            `${highCount} high-severity validation warnings`
          );
        }
      }

      this.repository.logProcessing({
        product_code: metadata.productCode,
        pdf_file_path: metadata.filePath,
        action: 'extract',
        status: 'success',
        processing_time_ms: Date.now() - startTime,
      });

      const reviewFlag = needsReview ? ' [NEEDS REVIEW]' : '';
      logger.info(
        `Successfully processed ${metadata.productCode} (ID: ${productId}) - ${completeness.completenessPercent}% complete${reviewFlag}`
      );

      progress.complete(true);
      return true;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';

      this.repository.markProductAsFailed(metadata, errorMsg);
      this.repository.logProcessing({
        product_code: metadata.productCode,
        pdf_file_path: metadata.filePath,
        action: 'extract',
        status: 'error',
        error_message: errorMsg,
        processing_time_ms: Date.now() - startTime,
      });

      logger.error(`Error processing ${metadata.productCode}: ${errorMsg}`, error);
      progress.complete(false);
      return false;
    }
  }

  // Retry failed products
  async retryFailed(): Promise<ProcessingResult> {
    logger.info('Retrying failed products...');

    const failedProducts = this.repository.getFailedProducts();
    logger.info(`Found ${failedProducts.length} failed products to retry`);

    if (failedProducts.length === 0) {
      return {
        totalProcessed: 0,
        successCount: 0,
        failureCount: 0,
        skippedCount: 0,
        elapsedMs: 0,
        successRate: 0,
      };
    }

    // Convert to metadata format
    const metadata: PDFFileMetadata[] = failedProducts.map((product) => ({
      productCode: product.product_code,
      productName: product.product_name,
      subbrand: product.subbrand || null,
      filePath: product.pdf_file_path,
      folderPath: product.folder_path,
      fileName: product.pdf_file_path.split(/[\\/]/).pop() || '',
    }));

    // Process with same logic as processAll
    const startTime = Date.now();
    const progress = new ProgressTracker(metadata.length);
    let successCount = 0;
    let failureCount = 0;

    for (const pdf of metadata) {
      const success = await this.processSinglePDF(pdf, progress);
      if (success) {
        successCount++;
      } else {
        failureCount++;
      }
    }

    const elapsedMs = Date.now() - startTime;
    const successRate = (successCount / (successCount + failureCount)) * 100;

    logger.info(`Retry complete: ${successCount} succeeded, ${failureCount} still failed`);

    return {
      totalProcessed: successCount + failureCount,
      successCount,
      failureCount,
      skippedCount: 0,
      elapsedMs,
      successRate,
    };
  }

  // Generate quality report
  generateReport(): void {
    logger.info('\n' + '='.repeat(70));
    logger.info('QUALITY REPORT');
    logger.info('='.repeat(70));

    const stats = this.repository.getStatistics();
    logger.info(`\nProcessing Statistics:`);
    logger.info(`  Total Products: ${stats.total}`);
    logger.info(`  Completed: ${stats.completed}`);
    logger.info(`  Failed: ${stats.failed}`);
    logger.info(`  Pending: ${stats.pending}`);
    logger.info(`  Success Rate: ${stats.successRate.toFixed(2)}%`);

    const completeness = this.repository.getCompletenessReport();
    logger.info(`\nData Completeness:`);

    if (completeness.totalProducts > 0) {
      logger.info(`  Products with Supplement Facts: ${completeness.withSupplementFacts} (${((completeness.withSupplementFacts / completeness.totalProducts) * 100).toFixed(1)}%)`);
      logger.info(`  Products with Ingredients: ${completeness.withIngredients} (${((completeness.withIngredients / completeness.totalProducts) * 100).toFixed(1)}%)`);
      logger.info(`  Products with Dietary Attributes: ${completeness.withDietaryAttributes} (${((completeness.withDietaryAttributes / completeness.totalProducts) * 100).toFixed(1)}%)`);
      logger.info(`  Avg Ingredients per Product: ${(completeness.avgIngredientsPerProduct || 0).toFixed(1)}`);
    } else {
      logger.info(`  No completed products yet`);
    }

    logger.info('\n' + '='.repeat(70) + '\n');
  }

  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }
}
