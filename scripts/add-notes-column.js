/**
 * Add Notes Column Migration Runner
 *
 * Adds a 'notes' TEXT column to all data tables in the database.
 *
 * Usage: node add-notes-column.js
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createBackup } from './backup-database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = path.join(__dirname, 'products.db');
const MIGRATION_PATH = path.join(__dirname, 'migrations', 'add-notes-column.sql');

/**
 * Checks if a column exists in a table
 */
function columnExists(db, tableName, columnName) {
  const tableInfo = db.prepare(`PRAGMA table_info(${tableName})`).all();
  return tableInfo.some(col => col.name === columnName);
}

/**
 * Runs the notes column migration
 */
function runMigration() {
  console.log('🚀 Adding Notes Column to All Tables\n');
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

  // Step 3: Create backup
  console.log('\n📦 Creating Database Backup...\n');
  const backupPath = createBackup();

  // Step 4: Check if notes column already exists
  const db = new Database(DB_PATH);

  const tables = ['products', 'supplement_facts', 'nutritional_values', 'ingredients', 'dietary_attributes', 'processing_log'];

  console.log('\n=' .repeat(60));
  console.log('\n🔍 Checking Existing Columns:\n');

  const tablesNeedingMigration = [];

  for (const table of tables) {
    const hasNotes = columnExists(db, table, 'notes');
    if (hasNotes) {
      console.log(`   ✅ ${table}: notes column already exists`);
    } else {
      console.log(`   ➕ ${table}: needs notes column`);
      tablesNeedingMigration.push(table);
    }
  }

  if (tablesNeedingMigration.length === 0) {
    console.log('\n✅ All tables already have the notes column. No migration needed.\n');
    db.close();
    return;
  }

  // Step 5: Run migration
  console.log('\n=' .repeat(60));
  console.log('\n🔧 Running Migration...\n');

  try {
    // Read migration SQL
    const migrationSQL = fs.readFileSync(MIGRATION_PATH, 'utf8');

    // Execute migration in a transaction
    const transaction = db.transaction(() => {
      // Parse and execute only the ALTER TABLE statements for tables that need it
      const lines = migrationSQL.split('\n');

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('ALTER TABLE')) {
          // Extract table name from the ALTER TABLE statement
          const match = trimmed.match(/ALTER TABLE (\w+)/);
          if (match) {
            const tableName = match[1];
            if (tablesNeedingMigration.includes(tableName)) {
              db.exec(trimmed);
              console.log(`   ✅ Added notes column to ${tableName}`);
            }
          }
        }
      }
    });

    transaction();

    console.log('\n✅ Migration completed successfully!\n');

    // Step 6: Verify columns were added
    console.log('=' .repeat(60));
    console.log('\n🔍 Verifying Migration:\n');

    let allSuccess = true;
    for (const table of tablesNeedingMigration) {
      const hasNotes = columnExists(db, table, 'notes');
      if (hasNotes) {
        console.log(`   ✅ ${table}: notes column verified`);
      } else {
        console.log(`   ❌ ${table}: notes column NOT found`);
        allSuccess = false;
      }
    }

    if (!allSuccess) {
      throw new Error('Migration verification failed - some columns were not added');
    }

    console.log('\n=' .repeat(60));
    console.log('\n🎉 Notes Column Added Successfully!\n');
    console.log(`   Backup saved at: ${backupPath}`);
    console.log(`   ${tablesNeedingMigration.length} table(s) updated\n`);

    db.close();

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
  runMigration();
}

export { runMigration };
