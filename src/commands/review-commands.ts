import { ProductRepository } from '../database/repository.js';
import path from 'path';

/**
 * Show the human review queue
 */
export async function showReviewQueue(status?: string): Promise<void> {
  const repository = new ProductRepository();
  const queue = repository.getReviewQueue(status || 'pending');

  console.log(`\n${'='.repeat(70)}`);
  console.log(`HUMAN REVIEW QUEUE${status ? ` (${status})` : ''}`);
  console.log('='.repeat(70));
  console.log(`Total items: ${queue.length}\n`);

  if (queue.length === 0) {
    console.log('No items in review queue.');
    console.log('='.repeat(70) + '\n');
    return;
  }

  queue.forEach((item, index) => {
    console.log(`${index + 1}. Product ${item.product_code} (ID: ${item.product_id})`);
    console.log(`   Priority: ${item.review_priority}`);
    console.log(`   Discrepancies: ${item.total_discrepancies} total (${item.high_severity_count} high, ${item.medium_severity_count} medium)`);
    console.log(`   Status: ${item.review_status}`);
    console.log(`   Created: ${item.created_at}`);
    if (item.review_notes) {
      console.log(`   Notes: ${item.review_notes}`);
    }
    console.log();
  });

  console.log(`To view details: npm start discrepancies <product_code>`);
  console.log('='.repeat(70) + '\n');
}

/**
 * Show discrepancies for a specific product
 */
export async function showDiscrepancies(productCode: string): Promise<void> {
  const repository = new ProductRepository();
  const product = repository.getProductByCode(productCode);

  if (!product) {
    console.error(`\nProduct ${productCode} not found\n`);
    return;
  }

  const discrepancies = repository.getDiscrepanciesForProduct(product.id!);

  console.log(`\n${'='.repeat(70)}`);
  console.log(`DISCREPANCIES FOR PRODUCT ${productCode}`);
  console.log('='.repeat(70));
  console.log(`Product: ${product.product_name}`);
  console.log(`Total discrepancies: ${discrepancies.length}\n`);

  if (discrepancies.length === 0) {
    console.log('No discrepancies found.');
    console.log('='.repeat(70) + '\n');
    return;
  }

  // Group by severity
  const bySeverity = {
    high: discrepancies.filter(d => d.severity === 'high'),
    medium: discrepancies.filter(d => d.severity === 'medium'),
    low: discrepancies.filter(d => d.severity === 'low')
  };

  (['high', 'medium', 'low'] as const).forEach(severity => {
    const items = bySeverity[severity];
    if (items.length === 0) return;

    console.log(`\n${severity.toUpperCase()} SEVERITY (${items.length}):`);
    console.log('-'.repeat(70));

    items.forEach((d, i) => {
      console.log(`  ${i + 1}. ${d.field_path}`);
      console.log(`     Type: ${d.discrepancy_type}`);
      console.log(`     Claude: ${d.claude_value}`);
      console.log(`     Grok:   ${d.grok_value}`);
      console.log(`     Confidence: ${d.confidence_score?.toFixed(1)}%`);
      console.log();
    });
  });

  console.log(`\nTo resolve: npm start resolve ${product.id} "your notes here"`);
  console.log('='.repeat(70) + '\n');
}

/**
 * Generate comparison report
 */
export async function generateComparisonReport(): Promise<void> {
  const repository = new ProductRepository();
  const stats = repository.getComparisonStatistics();

  console.log(`\n${'='.repeat(70)}`);
  console.log('VERIFICATION SYSTEM STATISTICS');
  console.log('='.repeat(70) + '\n');

  console.log(`Total products compared: ${stats.totalCompared}`);
  console.log(`Products with high discrepancies: ${stats.highDiscrepancyCount}`);
  console.log(`Pending human reviews: ${stats.pendingReviewCount}`);

  if (stats.totalCompared > 0) {
    const percentHighDisc = ((stats.highDiscrepancyCount / stats.totalCompared) * 100).toFixed(1);
    const percentPendingReview = ((stats.pendingReviewCount / stats.totalCompared) * 100).toFixed(1);

    console.log(`\nHigh discrepancy rate: ${percentHighDisc}%`);
    console.log(`Review queue rate: ${percentPendingReview}%`);
  }

  console.log('\n' + '='.repeat(70) + '\n');

  // Generate CSV report
  const reportPath = path.join(process.cwd(), 'comparison-report.csv');
  await repository.exportComparisonReport(reportPath);
  console.log(`Detailed report will be exported to: ${reportPath}`);
  console.log('(Export functionality coming soon)\n');
}

/**
 * Resolve a review item
 */
export async function resolveReview(productId: number, notes: string): Promise<void> {
  const repository = new ProductRepository();

  try {
    repository.markReviewResolved(productId, notes);
    console.log(`\n✓ Review for product ID ${productId} marked as resolved\n`);
    console.log(`Notes: ${notes}\n`);
  } catch (error) {
    console.error(`\n✗ Failed to resolve review: ${error instanceof Error ? error.message : 'Unknown error'}\n`);
  }
}

/**
 * Show verification statistics
 */
export async function showVerificationStats(): Promise<void> {
  const repository = new ProductRepository();
  const stats = repository.getComparisonStatistics();
  const reviewQueue = repository.getReviewQueue();

  console.log(`\n${'='.repeat(70)}`);
  console.log('VERIFICATION STATISTICS');
  console.log('='.repeat(70) + '\n');

  console.log('Comparison Coverage:');
  console.log(`  Total products verified: ${stats.totalCompared}`);
  console.log(`  Products with discrepancies: ${stats.highDiscrepancyCount}`);
  console.log();

  console.log('Review Queue:');
  const pendingReviews = reviewQueue.filter(r => r.review_status === 'pending');
  const inProgressReviews = reviewQueue.filter(r => r.review_status === 'in_progress');
  const resolvedReviews = reviewQueue.filter(r => r.review_status === 'resolved');
  const dismissedReviews = reviewQueue.filter(r => r.review_status === 'dismissed');

  console.log(`  Pending: ${pendingReviews.length}`);
  console.log(`  In Progress: ${inProgressReviews.length}`);
  console.log(`  Resolved: ${resolvedReviews.length}`);
  console.log(`  Dismissed: ${dismissedReviews.length}`);
  console.log(`  Total: ${reviewQueue.length}`);
  console.log();

  if (pendingReviews.length > 0) {
    console.log('Top Priority Items:');
    const topItems = pendingReviews
      .sort((a, b) => (b.review_priority || 0) - (a.review_priority || 0))
      .slice(0, 5);

    topItems.forEach((item, i) => {
      console.log(`  ${i + 1}. ${item.product_code} (Priority: ${item.review_priority}, ${item.high_severity_count} high-severity)`);
    });
  }

  console.log('\n' + '='.repeat(70) + '\n');
}
