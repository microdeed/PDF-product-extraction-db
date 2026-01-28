import path from 'path';

export interface PDFFileMetadata {
  productCode: string;
  productName: string;
  subbrand: string | null;
  filePath: string;
  folderPath: string;
  fileName: string;
}

// Regex pattern for product code extraction (3-6 digits followed by -PI_EN.pdf)
const PRODUCT_CODE_PATTERN = /^(\d{3,6})-PI_EN\.pdf$/;

// Extract product code from filename
export function extractProductCode(fileName: string): string | null {
  const match = fileName.match(PRODUCT_CODE_PATTERN);
  return match ? match[1] : null;
}

// Extract product name from folder name
// Example: "0358 Yummies" -> "Yummies"
// Example: "0358 Yummies Strawberry" -> "Yummies Strawberry"
export function extractProductName(folderName: string): string {
  // Remove leading product code if present
  const cleanName = folderName.replace(/^\d{3,6}\s+/, '').trim();
  return cleanName || folderName;
}

// Detect subbrand from folder depth
// Example: products/LifePlus Kids/0358 Yummies/0358-PI_EN.pdf -> "LifePlus Kids"
// Example: products/0358 Yummies/0358-PI_EN.pdf -> null
export function detectSubbrand(filePath: string, rootPath: string): string | null {
  const relativePath = path.relative(rootPath, filePath);
  const parts = relativePath.split(path.sep);

  // If there are more than 2 parts (folder + subfolder + file), first folder is subbrand
  if (parts.length > 2) {
    return parts[0];
  }

  return null;
}

// Parse PDF file metadata
export function parseFileMetadata(filePath: string, rootPath: string): PDFFileMetadata | null {
  const fileName = path.basename(filePath);
  const folderPath = path.dirname(filePath);
  const folderName = path.basename(folderPath);

  // Extract product code from filename
  const productCode = extractProductCode(fileName);
  if (!productCode) {
    return null;
  }

  // Extract product name from folder
  const productName = extractProductName(folderName);

  // Detect subbrand from path depth
  const subbrand = detectSubbrand(filePath, rootPath);

  return {
    productCode,
    productName,
    subbrand,
    filePath,
    folderPath,
    fileName,
  };
}

// Validate file path format
export function isValidPDFPath(filePath: string): boolean {
  const fileName = path.basename(filePath);
  return PRODUCT_CODE_PATTERN.test(fileName);
}

// Get all unique subbrands from a list of metadata
export function extractSubbrands(metadataList: PDFFileMetadata[]): string[] {
  const subbrands = new Set<string>();
  for (const metadata of metadataList) {
    if (metadata.subbrand) {
      subbrands.add(metadata.subbrand);
    }
  }
  return Array.from(subbrands).sort();
}

// Group PDFs by product code (for handling multiple flavors/variants)
export function groupByProductCode(metadataList: PDFFileMetadata[]): Map<string, PDFFileMetadata[]> {
  const grouped = new Map<string, PDFFileMetadata[]>();

  for (const metadata of metadataList) {
    const existing = grouped.get(metadata.productCode) || [];
    existing.push(metadata);
    grouped.set(metadata.productCode, existing);
  }

  return grouped;
}
