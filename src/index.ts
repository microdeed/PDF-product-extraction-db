#!/usr/bin/env node

import { BatchProcessor } from './processor/batch-processor.js';
import { ProductRepository } from './database/repository.js';
import { scanPDFDirectory } from './scanner/pdf-scanner.js';
import logger from './utils/logger.js';
import { env } from './config/env.js';
import {
  showReviewQueue,
  showDiscrepancies,
  generateComparisonReport,
  resolveReview,
  showVerificationStats
} from './commands/review-commands.js';

// CLI Commands
const COMMANDS = {
  PROCESS: 'process',
  RETRY: 'retry-failed',
  REPORT: 'report',
  VERIFY: 'verify',
  REVIEW_QUEUE: 'review-queue',
  DISCREPANCIES: 'discrepancies',
  COMPARISON_REPORT: 'comparison-report',
  RESOLVE: 'resolve',
  VERIFICATION_STATS: 'verification-stats',
  HELP: 'help',
} as const;

type Command = typeof COMMANDS[keyof typeof COMMANDS];

async function main() {
  const args = process.argv.slice(2);
  const command = (args[0] || COMMANDS.PROCESS) as Command;

  printBanner();

  try {
    switch (command) {
      case COMMANDS.PROCESS:
        await processCommand();
        break;

      case COMMANDS.RETRY:
        await retryCommand();
        break;

      case COMMANDS.REPORT:
        await reportCommand();
        break;

      case COMMANDS.VERIFY:
        await verifyCommand();
        break;

      case COMMANDS.REVIEW_QUEUE:
        await showReviewQueue(args[1]);
        break;

      case COMMANDS.DISCREPANCIES:
        if (args.length < 2) {
          console.error('\nError: Product code required');
          console.log('Usage: npm start discrepancies <product_code>\n');
          process.exit(1);
        }
        await showDiscrepancies(args[1]);
        break;

      case COMMANDS.COMPARISON_REPORT:
        await generateComparisonReport();
        break;

      case COMMANDS.RESOLVE:
        if (args.length < 2) {
          console.error('\nError: Product ID required');
          console.log('Usage: npm start resolve <product_id> [notes]\n');
          process.exit(1);
        }
        await resolveReview(parseInt(args[1]), args.slice(2).join(' ') || 'Resolved');
        break;

      case COMMANDS.VERIFICATION_STATS:
        await showVerificationStats();
        break;

      case COMMANDS.HELP:
        printHelp();
        break;

      default:
        logger.error(`Unknown command: ${command}`);
        printHelp();
        process.exit(1);
    }

    process.exit(0);
  } catch (error) {
    logger.error('Fatal error:', error);
    process.exit(1);
  }
}

function printBanner() {
  console.log('\n' + '='.repeat(70));
  console.log('  PDF Product Information Extraction System');
  console.log('  Powered by Claude Vision API');
  console.log('='.repeat(70) + '\n');
}

function printHelp() {
  console.log('Usage: npm run <command> [options]\n');
  console.log('Available commands:\n');
  console.log('Processing:');
  console.log('  process [limit]        Process PDFs (default: all, limit: number to process)');
  console.log('                         Example: npm start process 5  (process first 5)');
  console.log('  retry-failed           Retry extraction for failed products');
  console.log('  report                 Generate quality report');
  console.log('  verify                 Verify database integrity and scan PDFs\n');
  console.log('Verification & Review:');
  console.log('  review-queue [status]  Show human review queue (status: pending|in_progress|resolved|dismissed)');
  console.log('  discrepancies <code>   Show discrepancies for a product code');
  console.log('  comparison-report      Generate comparison report between Claude and Grok');
  console.log('  resolve <id> [notes]   Mark a review item as resolved');
  console.log('  verification-stats     Show verification system statistics\n');
  console.log('Other:');
  console.log('  help                   Show this help message\n');
  console.log('Configuration:');
  console.log(`  PDF Directory: ${env.PDF_ROOT_PATH}`);
  console.log(`  Database: ${env.DATABASE_PATH}`);
  console.log(`  Concurrency: ${env.CONCURRENT_PROCESSES}`);
  console.log(`  Max Retries: ${env.MAX_RETRIES}`);
  console.log(`  Rate Limit: ${env.RATE_LIMIT_PER_MINUTE} req/min`);
  console.log(`  Grok Verification: ${env.ENABLE_GROK_VERIFICATION ? 'Enabled' : 'Disabled'}`);
  console.log(`  Hybrid Extraction: ${env.ENABLE_HYBRID_EXTRACTION ? 'Enabled' : 'Disabled'}\n`);
}

async function processCommand() {
  logger.info('Starting PDF processing...');

  // Parse limit from command line args (e.g., npm start process 10)
  const args = process.argv.slice(2);
  const limitArg = args[1] ? parseInt(args[1]) : undefined;
  const limit = limitArg && limitArg > 0 ? limitArg : undefined;

  if (limit) {
    logger.info(`Processing limited to ${limit} PDFs`);
  }

  const processor = new BatchProcessor();
  const result = await processor.processAll({
    skipExisting: true,
    concurrency: env.CONCURRENT_PROCESSES,
    limit,
  });

  logger.info('\nProcessing Summary:');
  logger.info(`  Total Processed: ${result.totalProcessed}`);
  logger.info(`  Success: ${result.successCount}`);
  logger.info(`  Failed: ${result.failureCount}`);
  logger.info(`  Skipped: ${result.skippedCount}`);
  logger.info(`  Success Rate: ${result.successRate.toFixed(2)}%`);
  logger.info(`  Duration: ${formatDuration(result.elapsedMs)}\n`);

  // Generate report
  processor.generateReport();
}

async function retryCommand() {
  logger.info('Retrying failed products...');

  const processor = new BatchProcessor();
  const result = await processor.retryFailed();

  logger.info('\nRetry Summary:');
  logger.info(`  Total Retried: ${result.totalProcessed}`);
  logger.info(`  Success: ${result.successCount}`);
  logger.info(`  Still Failed: ${result.failureCount}`);
  logger.info(`  Success Rate: ${result.successRate.toFixed(2)}%`);
  logger.info(`  Duration: ${formatDuration(result.elapsedMs)}\n`);

  // Generate updated report
  processor.generateReport();
}

async function reportCommand() {
  logger.info('Generating quality report...');

  const processor = new BatchProcessor();
  processor.generateReport();

  const repository = new ProductRepository();
  const failedProducts = repository.getFailedProducts();

  if (failedProducts.length > 0) {
    logger.info('Failed Products:');
    failedProducts.forEach((product) => {
      logger.info(`  ${product.product_code} - ${product.product_name}`);
      logger.info(`    Error: ${product.error_message}`);
    });
  }
}

async function verifyCommand() {
  logger.info('Verifying system...\n');

  // Verify PDF directory
  logger.info('1. Scanning PDF directory...');
  try {
    const scanResult = await scanPDFDirectory();
    logger.info(`   ✓ Found ${scanResult.validFiles} valid PDFs`);

    if (scanResult.invalidFiles > 0) {
      logger.warn(`   ⚠ Found ${scanResult.invalidFiles} invalid files`);
      scanResult.errors.forEach((error) => logger.warn(`     - ${error}`));
    }

    // Check for duplicate product codes
    const codes = new Set<string>();
    const duplicates: string[] = [];
    scanResult.metadata.forEach((pdf) => {
      if (codes.has(pdf.productCode)) {
        duplicates.push(pdf.productCode);
      }
      codes.add(pdf.productCode);
    });

    if (duplicates.length > 0) {
      logger.warn(`   ⚠ Found duplicate product codes: ${duplicates.join(', ')}`);
    } else {
      logger.info('   ✓ No duplicate product codes found');
    }

    // Check for subbrands
    const subbrands = new Set(
      scanResult.metadata.filter((m) => m.subbrand).map((m) => m.subbrand!)
    );
    if (subbrands.size > 0) {
      logger.info(`   ✓ Found ${subbrands.size} subbrands: ${Array.from(subbrands).join(', ')}`);
    }
  } catch (error) {
    logger.error('   ✗ Failed to scan PDF directory:', error);
  }

  // Verify database
  logger.info('\n2. Checking database...');
  try {
    const repository = new ProductRepository();
    const stats = repository.getStatistics();

    logger.info(`   ✓ Database connected`);
    logger.info(`   ✓ Total products: ${stats.total}`);
    logger.info(`   ✓ Completed: ${stats.completed}`);
    logger.info(`   ✓ Failed: ${stats.failed}`);
    logger.info(`   ✓ Pending: ${stats.pending}`);

    // Check for missing required fields
    logger.info('\n3. Checking data quality...');
    const completeness = repository.getCompletenessReport();
    logger.info(`   ✓ Products with supplement facts: ${completeness.withSupplementFacts}/${completeness.totalProducts}`);
    logger.info(`   ✓ Products with ingredients: ${completeness.withIngredients}/${completeness.totalProducts}`);
    logger.info(`   ✓ Average ingredients per product: ${completeness.avgIngredientsPerProduct ? completeness.avgIngredientsPerProduct.toFixed(1) : '0'}`);

    if (completeness.totalProducts > 0) {
      const completenessPercent =
        (completeness.withSupplementFacts + completeness.withIngredients) /
        (completeness.totalProducts * 2) *
        100;

      if (completenessPercent >= 90) {
        logger.info(`   ✓ Overall data completeness: ${completenessPercent.toFixed(1)}% (Good)`);
      } else if (completenessPercent >= 70) {
        logger.warn(`   ⚠ Overall data completeness: ${completenessPercent.toFixed(1)}% (Acceptable)`);
      } else {
        logger.error(`   ✗ Overall data completeness: ${completenessPercent.toFixed(1)}% (Poor)`);
      }
    } else {
      logger.info('   ℹ No products in database yet');
    }
  } catch (error) {
    logger.error('   ✗ Database verification failed:', error);
  }

  // Verify configuration
  logger.info('\n4. Checking configuration...');
  logger.info(`   ✓ API Key: ${env.ANTHROPIC_API_KEY ? 'Set' : 'Missing'}`);
  logger.info(`   ✓ PDF Root: ${env.PDF_ROOT_PATH}`);
  logger.info(`   ✓ Database Path: ${env.DATABASE_PATH}`);
  logger.info(`   ✓ Model: ${env.AI_MODEL}`);
  logger.info(`   ✓ Concurrency: ${env.CONCURRENT_PROCESSES}`);

  logger.info('\n✓ Verification complete\n');
}

function formatDuration(ms: number): string {
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

// Start the CLI
main().catch((error) => {
  logger.error('Unhandled error:', error);
  process.exit(1);
});
