/**
 * Database Backup Utility
 *
 * Creates a timestamped backup of the products database before running migrations.
 * Usage: node backup-database.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = path.join(__dirname, 'products.db');

/**
 * Creates a backup of the database with a timestamp
 * @returns {string} Path to the backup file
 */
function createBackup() {
  if (!fs.existsSync(DB_PATH)) {
    console.error(`❌ Database not found at: ${DB_PATH}`);
    process.exit(1);
  }

  const timestamp = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const backupPath = `${DB_PATH}.backup.${timestamp}`;

  console.log('📦 Creating database backup...');
  console.log(`   Source: ${DB_PATH}`);
  console.log(`   Backup: ${backupPath}`);

  try {
    // Copy the database file
    fs.copyFileSync(DB_PATH, backupPath);

    // Verify the backup is readable
    const stats = fs.statSync(backupPath);
    console.log(`✅ Backup created successfully (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);

    // Verify integrity by checking if it's a valid SQLite file
    const buffer = Buffer.alloc(16);
    const fd = fs.openSync(backupPath, 'r');
    fs.readSync(fd, buffer, 0, 16, 0);
    fs.closeSync(fd);

    const header = buffer.toString('utf8', 0, 16);
    if (!header.startsWith('SQLite format 3')) {
      throw new Error('Backup file is not a valid SQLite database');
    }

    console.log('✅ Backup integrity verified');
    console.log(`\n💾 Backup location: ${backupPath}\n`);

    return backupPath;
  } catch (error) {
    console.error('❌ Backup failed:', error.message);
    process.exit(1);
  }
}

// Run if executed directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createBackup();
}

export { createBackup };
