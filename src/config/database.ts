import Database from 'better-sqlite3';
import { env } from './env.js';
import { initializeDatabase } from '../database/schema.js';
import logger from '../utils/logger.js';
import path from 'path';

let dbInstance: Database.Database | null = null;

export function getDatabase(): Database.Database {
  if (!dbInstance) {
    const dbPath = path.resolve(env.DATABASE_PATH);
    logger.info(`Connecting to database: ${dbPath}`);

    dbInstance = new Database(dbPath);

    // Initialize schema
    initializeDatabase(dbInstance);

    // Set pragmas for better performance
    dbInstance.pragma('journal_mode = WAL');
    dbInstance.pragma('synchronous = NORMAL');
    dbInstance.pragma('cache_size = 10000');
    dbInstance.pragma('temp_store = MEMORY');

    logger.info('Database connection established');
  }

  return dbInstance;
}

export function closeDatabase(): void {
  if (dbInstance) {
    logger.info('Closing database connection');
    dbInstance.close();
    dbInstance = null;
  }
}

// Graceful shutdown handlers
process.on('exit', closeDatabase);
process.on('SIGINT', () => {
  closeDatabase();
  process.exit(0);
});
process.on('SIGTERM', () => {
  closeDatabase();
  process.exit(0);
});
