import { readFileSync, existsSync, mkdirSync, unlinkSync } from 'fs';
import { execSync } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';
import { PDFDocument } from 'pdf-lib';
import logger from '../utils/logger.js';

export interface PDFConversionResult {
  success: boolean;
  base64Data?: string;
  pageCount?: number;
  error?: string;
}

// Convert PDF file to base64 for Vision API
// Anthropic's Vision API accepts PDF documents directly
export async function convertPDFToBase64(pdfPath: string): Promise<PDFConversionResult> {
  try {
    logger.debug(`Converting PDF to base64: ${pdfPath}`);

    // Read PDF file
    const pdfBytes = readFileSync(pdfPath);

    // Load PDF to get page count
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const pageCount = pdfDoc.getPageCount();

    logger.debug(`PDF has ${pageCount} pages`);

    // Convert to base64
    const base64Data = pdfBytes.toString('base64');

    logger.debug(`PDF converted to base64 (${base64Data.length} characters)`);

    return {
      success: true,
      base64Data,
      pageCount,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`Failed to convert PDF to base64: ${errorMsg}`, error);

    return {
      success: false,
      error: errorMsg,
    };
  }
}

// Validate PDF file before conversion
export async function validatePDF(pdfPath: string): Promise<{ isValid: boolean; error?: string }> {
  try {
    const pdfBytes = readFileSync(pdfPath);
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const pageCount = pdfDoc.getPageCount();

    if (pageCount === 0) {
      return {
        isValid: false,
        error: 'PDF has no pages',
      };
    }

    // Check file size (warn if > 10MB, Vision API has limits)
    const fileSizeKB = pdfBytes.length / 1024;
    if (fileSizeKB > 10240) {
      logger.warn(`PDF file is large (${Math.round(fileSizeKB / 1024)}MB), may exceed API limits`);
    }

    return { isValid: true };
  } catch (error) {
    return {
      isValid: false,
      error: error instanceof Error ? error.message : 'Invalid PDF file',
    };
  }
}

// Get PDF metadata
export async function getPDFMetadata(pdfPath: string): Promise<{
  pageCount: number;
  fileSizeKB: number;
  title?: string;
  author?: string;
} | null> {
  try {
    const pdfBytes = readFileSync(pdfPath);
    const pdfDoc = await PDFDocument.load(pdfBytes);

    return {
      pageCount: pdfDoc.getPageCount(),
      fileSizeKB: pdfBytes.length / 1024,
      title: pdfDoc.getTitle() || undefined,
      author: pdfDoc.getAuthor() || undefined,
    };
  } catch (error) {
    logger.error('Failed to get PDF metadata:', error);
    return null;
  }
}

export interface PDFToImagesResult {
  success: boolean;
  images?: string[]; // base64 PNG strings (without data URI prefix)
  pageCount?: number;
  error?: string;
}

// Convert PDF to PNG images for APIs that don't support PDF (like Grok)
// Uses ImageMagick CLI directly (requires ImageMagick + Ghostscript installed)
export async function convertPDFToImages(pdfPath: string): Promise<PDFToImagesResult> {
  const tempDir = join(tmpdir(), 'pdf-convert-' + Date.now());
  const tempFiles: string[] = [];

  try {
    logger.debug(`Converting PDF to images: ${pdfPath}`);

    // Get page count first
    const pdfBytes = readFileSync(pdfPath);
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const pageCount = pdfDoc.getPageCount();

    logger.debug(`PDF has ${pageCount} pages, converting to PNG images`);

    // Create temp directory
    if (!existsSync(tempDir)) {
      mkdirSync(tempDir, { recursive: true });
    }

    const images: string[] = [];

    // Convert each page using ImageMagick CLI
    for (let page = 0; page < pageCount; page++) {
      const outputPath = join(tempDir, `page-${page}.png`);
      tempFiles.push(outputPath);

      // ImageMagick command: magick -density 150 "input.pdf[page]" -resize 1200x1600 "output.png"
      const cmd = `magick -density 150 "${pdfPath}[${page}]" -resize 1200x1600 "${outputPath}"`;

      try {
        execSync(cmd, { encoding: 'utf8', stdio: 'pipe' });

        if (existsSync(outputPath)) {
          const buffer = readFileSync(outputPath);
          const base64 = buffer.toString('base64');
          images.push(base64);
          logger.debug(`Converted page ${page + 1}/${pageCount}`);
        } else {
          throw new Error(`Output file not created for page ${page + 1}`);
        }
      } catch (cmdError: any) {
        throw new Error(`ImageMagick failed on page ${page + 1}: ${cmdError.message}`);
      }
    }

    logger.debug(`Successfully converted ${images.length} pages to PNG images`);

    return {
      success: true,
      images,
      pageCount
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`Failed to convert PDF to images: ${errorMsg}`, error);

    return {
      success: false,
      error: errorMsg
    };
  } finally {
    // Clean up temp files
    for (const file of tempFiles) {
      try {
        if (existsSync(file)) {
          unlinkSync(file);
        }
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}
