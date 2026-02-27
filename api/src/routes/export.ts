import { Router } from 'express';
import archiver from 'archiver';
import { format } from 'fast-csv';
import { getExportDb, getTableNames, getTableColumns, iterateTable } from '../services/export-service.js';

const router = Router();

router.get('/export-csv', (_req, res) => {
  const date = new Date().toISOString().split('T')[0];
  const filename = `product-database-export-${date}.zip`;

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  const archive = archiver('zip', { zlib: { level: 9 } });

  archive.on('error', (err) => {
    console.error('Archive error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to create archive' });
    }
  });

  archive.pipe(res);

  const db = getExportDb();

  try {
    const tableNames = getTableNames();

    for (const tableName of tableNames) {
      const csvStream = format({ headers: true });
      archive.append(csvStream, { name: `${tableName}.csv` });

      const columns = getTableColumns(tableName);

      // Write rows
      for (const row of iterateTable(db, tableName)) {
        // Create ordered row object based on column order
        const orderedRow: Record<string, unknown> = {};
        for (const col of columns) {
          orderedRow[col] = row[col];
        }
        csvStream.write(orderedRow);
      }

      csvStream.end();
    }

    archive.finalize();
  } catch (error) {
    console.error('Export error:', error);
    db.close();
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to export data' });
    }
  } finally {
    // Close database after archive is finalized
    archive.on('finish', () => {
      db.close();
    });
  }
});

export default router;
