import { glob } from 'glob';
import path from 'path';
import { parseFileMetadata, PDFFileMetadata, isValidPDFPath } from './file-parser.js';
import logger from '../utils/logger.js';
import { env } from '../config/env.js';

export interface ScanResult {
  totalFiles: number;
  validFiles: number;
  invalidFiles: number;
  metadata: PDFFileMetadata[];
  errors: string[];
}

// Scan directory for PDF files matching the pattern
export async function scanPDFDirectory(rootPath?: string): Promise<ScanResult> {
  const scanPath = rootPath || env.PDF_ROOT_PATH;
  const absolutePath = path.resolve(scanPath);

  logger.info(`Scanning directory: ${absolutePath}`);
  logger.info('Looking for files matching pattern: **/*-PI_EN.pdf');

  const result: ScanResult = {
    totalFiles: 0,
    validFiles: 0,
    invalidFiles: 0,
    metadata: [],
    errors: [],
  };

  try {
    // Use glob to find all PDF files recursively
    const pattern = '**/*-PI_EN.pdf';
    const files = await glob(pattern, {
      cwd: absolutePath,
      absolute: true,
      nodir: true,
      windowsPathsNoEscape: true,
    });

    result.totalFiles = files.length;
    logger.info(`Found ${files.length} PDF files`);

    // Process each file
    for (const filePath of files) {
      try {
        // Validate file path format
        if (!isValidPDFPath(filePath)) {
          result.invalidFiles++;
          result.errors.push(`Invalid file format: ${filePath}`);
          logger.warn(`Skipping invalid file: ${filePath}`);
          continue;
        }

        // Parse file metadata
        const metadata = parseFileMetadata(filePath, absolutePath);
        if (!metadata) {
          result.invalidFiles++;
          result.errors.push(`Failed to parse metadata: ${filePath}`);
          logger.warn(`Failed to parse metadata: ${filePath}`);
          continue;
        }

        result.metadata.push(metadata);
        result.validFiles++;

        logger.debug(
          `Parsed: ${metadata.productCode} - ${metadata.productName}${
            metadata.subbrand ? ` (${metadata.subbrand})` : ''
          }`
        );
      } catch (error) {
        result.invalidFiles++;
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        result.errors.push(`Error processing ${filePath}: ${errorMsg}`);
        logger.error(`Error processing file ${filePath}:`, error);
      }
    }

    logger.info(
      `Scan complete: ${result.validFiles} valid, ${result.invalidFiles} invalid`
    );

    // Log subbrand summary
    const subbrands = new Set(
      result.metadata.filter((m) => m.subbrand).map((m) => m.subbrand!)
    );
    if (subbrands.size > 0) {
      logger.info(`Found ${subbrands.size} subbrands: ${Array.from(subbrands).join(', ')}`);
    }

    return result;
  } catch (error) {
    logger.error('Error scanning directory:', error);
    throw new Error(
      `Failed to scan directory ${absolutePath}: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`
    );
  }
}

// Get specific PDF file by product code
export async function findPDFByProductCode(
  productCode: string,
  rootPath?: string
): Promise<PDFFileMetadata | null> {
  const scanPath = rootPath || env.PDF_ROOT_PATH;
  const absolutePath = path.resolve(scanPath);

  try {
    // Search for file with specific product code
    const pattern = `**/${productCode}-PI_EN.pdf`;
    const files = await glob(pattern, {
      cwd: absolutePath,
      absolute: true,
      nodir: true,
      windowsPathsNoEscape: true,
    });

    if (files.length === 0) {
      return null;
    }

    if (files.length > 1) {
      logger.warn(
        `Multiple PDFs found for product code ${productCode}, using first match`
      );
    }

    return parseFileMetadata(files[0], absolutePath);
  } catch (error) {
    logger.error(`Error finding PDF for product code ${productCode}:`, error);
    return null;
  }
}

// Validate scan results
export function validateScanResults(result: ScanResult): {
  isValid: boolean;
  warnings: string[];
} {
  const warnings: string[] = [];
  let isValid = true;

  if (result.totalFiles === 0) {
    warnings.push('No PDF files found in directory');
    isValid = false;
  }

  if (result.validFiles === 0 && result.totalFiles > 0) {
    warnings.push('No valid PDF files found (all files failed validation)');
    isValid = false;
  }

  if (result.invalidFiles > 0) {
    warnings.push(
      `${result.invalidFiles} files failed validation (${Math.round(
        (result.invalidFiles / result.totalFiles) * 100
      )}%)`
    );
  }

  const duplicates = findDuplicateProductCodes(result.metadata);
  if (duplicates.length > 0) {
    warnings.push(
      `Found duplicate product codes: ${duplicates.join(', ')}`
    );
  }

  return { isValid, warnings };
}

// Find duplicate product codes
function findDuplicateProductCodes(metadata: PDFFileMetadata[]): string[] {
  const codes = new Map<string, number>();

  for (const item of metadata) {
    codes.set(item.productCode, (codes.get(item.productCode) || 0) + 1);
  }

  return Array.from(codes.entries())
    .filter(([, count]) => count > 1)
    .map(([code]) => code);
}
