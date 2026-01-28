/**
 * Database Migration Runner
 *
 * Runs the ID alignment migration with automatic backup and rollback on failure.
 *
 * Usage: node run-migration.js
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createBackup } from './backup-database.js';
import { verifyAlignment } from './verify-alignment.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = path.join(__dirname, 'products.db');
const MIGRATION_PATH = path.join(__dirname, 'migrations', 'realign-ids.sql');

/**
 * Runs the database migration
 */
async function runMigration() {
  console.log('🚀 Starting Database ID Alignment Migration\n');
  console.log('=' .repeat(60));

  // Step 1: Verify database exists
  if (!fs.existsSync(DB_PATH)) {
    console.error(`❌ Database not found at: ${DB_PATH}`);
    process.exit(1);
  }

  // Step 2: Verify migration script exists
  if (!fs.existsSync(MIGRATION_PATH)) {
    console.error(`❌ Migration script not found at: ${MIGRATION_PATH}`);
    process.exit(1);
  }

  // Step 3: Show current state
  console.log('\n📊 Current Database State:\n');
  verifyAlignment();

  // Step 4: Ask for confirmation
  console.log('\n⚠️  IMPORTANT: This migration will modify your database.');
  console.log('   A backup will be created automatically before proceeding.\n');

  // Step 5: Create backup
  console.log('=' .repeat(60));
  const backupPath = createBackup();

  // Step 6: Run migration
  console.log('=' .repeat(60));
  console.log('\n🔧 Running Migration...\n');

  const db = new Database(DB_PATH);

  try {
    // Read migration SQL
    const migrationSQL = fs.readFileSync(MIGRATION_PATH, 'utf8');

    // Get pre-migration counts
    const preCounts = {
      products: db.prepare('SELECT COUNT(*) as count FROM products').get().count,
      supplementFacts: db.prepare('SELECT COUNT(*) as count FROM supplement_facts').get().count,
      nutritionalValues: db.prepare('SELECT COUNT(*) as count FROM nutritional_values').get().count,
      ingredients: db.prepare('SELECT COUNT(*) as count FROM ingredients').get().count,
      dietaryAttributes: db.prepare('SELECT COUNT(*) as count FROM dietary_attributes').get().count,
    };

    console.log('📋 Pre-Migration Counts:');
    console.log(`   Products:            ${preCounts.products}`);
    console.log(`   Supplement Facts:    ${preCounts.supplementFacts}`);
    console.log(`   Nutritional Values:  ${preCounts.nutritionalValues}`);
    console.log(`   Ingredients:         ${preCounts.ingredients}`);
    console.log(`   Dietary Attributes:  ${preCounts.dietaryAttributes}`);

    // Run migration in a transaction
    console.log('\n⚙️  Executing migration...');

    // Disable foreign key constraints before migration
    db.pragma('foreign_keys = OFF');
    console.log('   ⚠️  Foreign key constraints temporarily disabled');

    const transaction = db.transaction(() => {
      // Remove PRAGMA statements from SQL as they must be outside transaction
      const cleanSQL = migrationSQL
        .replace(/PRAGMA\s+foreign_keys\s*=\s*OFF\s*;/gi, '')
        .replace(/PRAGMA\s+foreign_keys\s*=\s*ON\s*;/gi, '');

      // Execute the migration SQL
      db.exec(cleanSQL);
    });

    try {
      // Execute the transaction
      transaction();
      console.log('   ✅ Migration executed successfully');
    } finally {
      // Re-enable foreign key constraints after migration
      db.pragma('foreign_keys = ON');
      console.log('   ✅ Foreign key constraints re-enabled');
    }

    console.log('   ✅ All migration statements executed successfully');

    // Get post-migration counts
    const postCounts = {
      products: db.prepare('SELECT COUNT(*) as count FROM products').get().count,
      supplementFacts: db.prepare('SELECT COUNT(*) as count FROM supplement_facts').get().count,
      nutritionalValues: db.prepare('SELECT COUNT(*) as count FROM nutritional_values').get().count,
      ingredients: db.prepare('SELECT COUNT(*) as count FROM ingredients').get().count,
      dietaryAttributes: db.prepare('SELECT COUNT(*) as count FROM dietary_attributes').get().count,
    };

    console.log('\n📋 Post-Migration Counts:');
    console.log(`   Products:            ${postCounts.products}`);
    console.log(`   Supplement Facts:    ${postCounts.supplementFacts}`);
    console.log(`   Nutritional Values:  ${postCounts.nutritionalValues}`);
    console.log(`   Ingredients:         ${postCounts.ingredients}`);
    console.log(`   Dietary Attributes:  ${postCounts.dietaryAttributes}`);

    // Verify counts match
    console.log('\n🔍 Verifying Data Integrity:');

    const countsMatch =
      preCounts.products === postCounts.products &&
      preCounts.supplementFacts === postCounts.supplementFacts &&
      preCounts.nutritionalValues === postCounts.nutritionalValues &&
      preCounts.ingredients === postCounts.ingredients &&
      preCounts.dietaryAttributes === postCounts.dietaryAttributes;

    if (countsMatch) {
      console.log('   ✅ All record counts match pre-migration state');
    } else {
      console.log('   ⚠️  Record count mismatch detected:');
      if (preCounts.products !== postCounts.products) {
        console.log(`      Products: ${preCounts.products} → ${postCounts.products}`);
      }
      if (preCounts.supplementFacts !== postCounts.supplementFacts) {
        console.log(`      Supplement Facts: ${preCounts.supplementFacts} → ${postCounts.supplementFacts}`);
      }
      if (preCounts.nutritionalValues !== postCounts.nutritionalValues) {
        console.log(`      Nutritional Values: ${preCounts.nutritionalValues} → ${postCounts.nutritionalValues}`);
      }
      if (preCounts.ingredients !== postCounts.ingredients) {
        console.log(`      Ingredients: ${preCounts.ingredients} → ${postCounts.ingredients}`);
      }
      if (preCounts.dietaryAttributes !== postCounts.dietaryAttributes) {
        console.log(`      Dietary Attributes: ${preCounts.dietaryAttributes} → ${postCounts.dietaryAttributes}`);
      }
      throw new Error('Record count mismatch - data may be corrupted');
    }

    // Test a specific product alignment
    console.log('\n🧪 Testing Specific Products:');

    // Test product 94 (the example from the plan)
    const product94 = db.prepare(`
      SELECT p.id as product_id, sf.id as supplement_fact_id, p.product_name
      FROM products p
      JOIN supplement_facts sf ON p.id = sf.product_id
      WHERE p.id = 94
    `).get();

    if (product94) {
      console.log(`   Product 94: supplement_facts.id = ${product94.supplement_fact_id}`);
      if (product94.product_id === product94.supplement_fact_id) {
        console.log('      ✅ Correctly aligned');
      } else {
        console.log('      ❌ Still misaligned');
        throw new Error('Product 94 alignment test failed');
      }
    }

    // Test product 99
    const product99 = db.prepare(`
      SELECT p.id as product_id, sf.id as supplement_fact_id, p.product_name
      FROM products p
      JOIN supplement_facts sf ON p.id = sf.product_id
      WHERE p.id = 99
    `).get();

    if (product99) {
      console.log(`   Product 99: supplement_facts.id = ${product99.supplement_fact_id}`);
      if (product99.product_id === product99.supplement_fact_id) {
        console.log('      ✅ Correctly aligned');
      } else {
        console.log('      ❌ Still misaligned');
        throw new Error('Product 99 alignment test failed');
      }
    }

    console.log('\n✅ Migration completed successfully!\n');

    db.close();

    // Step 7: Verify final state
    console.log('=' .repeat(60));
    console.log('\n📊 Final Database State:\n');
    const isAligned = verifyAlignment();

    if (!isAligned) {
      throw new Error('Post-migration verification failed - alignment issues detected');
    }

    console.log('=' .repeat(60));
    console.log('\n🎉 Migration Complete!\n');
    console.log(`   Backup saved at: ${backupPath}`);
    console.log(`   Database is now fully aligned and healthy.\n`);

  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    console.error('\n🔄 Rolling back changes...');

    db.close();

    // Restore from backup
    try {
      fs.copyFileSync(backupPath, DB_PATH);
      console.log('✅ Database restored from backup');
      console.log(`   Backup location: ${backupPath}\n`);
    } catch (restoreError) {
      console.error('❌ Rollback failed:', restoreError.message);
      console.error(`   Please manually restore from: ${backupPath}\n`);
    }

    process.exit(1);
  }
}

// Run if executed directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runMigration().catch((error) => {
    console.error('\n❌ Fatal error:', error.message);
    process.exit(1);
  });
}

export { runMigration };
