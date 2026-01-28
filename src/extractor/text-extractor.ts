import fs from 'fs/promises';
import logger from '../utils/logger.js';
import { extractText } from 'unpdf';

export interface PDFTextExtraction {
  success: boolean;
  rawText?: string;
  pageTexts?: string[];
  metadata?: {
    pageCount: number;
    hasText: boolean;
    hasImages: boolean;
  };
  error?: string;
}

const SECTION_MARKERS = {
  ingredients: ['INGREDIENTS:', 'Ingredients:', 'INGREDIENT LIST:', 'Other Ingredients:'],
  directions: ['DIRECTIONS:', 'Directions:', 'HOW TO USE:', 'SUGGESTED USE:', 'Suggested Use:'],
  caution: ['CAUTION:', 'WARNING:', 'WARNINGS:', 'Caution:', 'Warning:', 'Warnings:'],
  supplementFacts: ['SUPPLEMENT FACTS', 'NUTRITIONAL INFORMATION', 'Supplement Facts', 'NUTRITION FACTS'],
  // New markers for additional fields
  description: ['PRODUCT DESCRIPTION', 'Description:', 'DESCRIPTION:', 'About this product', 'About This Product', 'ABOUT THIS PRODUCT'],
  references: ['REFERENCES', 'References:', 'REFERENCES:', 'Citations:', 'CITATIONS:', '*These statements', '†These statements', '* These statements', '† These statements'],
  dietaryAttributes: ['✓', '✔', 'Vegan', 'VEGAN', 'Vegetarian', 'VEGETARIAN', 'Gluten-Free', 'GLUTEN-FREE', 'Gluten Free', 'Non-GMO', 'NON-GMO', 'Kosher', 'KOSHER', 'Halal', 'HALAL', 'Dairy-Free', 'DAIRY-FREE', 'Soy-Free', 'SOY-FREE', 'Sugar-Free', 'SUGAR-FREE', 'Organic', 'ORGANIC'],
};

/**
 * Find the position after the product name/slogan in the raw text.
 * Used to anchor description extraction to the correct location.
 * Returns position after the product name, or 0 if not found.
 */
function findProductNamePosition(rawText: string, productName: string, productSlogan?: string | null): number {
  // Try to find the slogan first if available (it comes after product name)
  if (productSlogan && productSlogan.trim().length > 0) {
    const sloganPos = rawText.indexOf(productSlogan);
    if (sloganPos !== -1) {
      return sloganPos + productSlogan.length;
    }
    // Try case-insensitive match for slogan
    const sloganLower = productSlogan.toLowerCase();
    const rawTextLower = rawText.toLowerCase();
    const sloganPosLower = rawTextLower.indexOf(sloganLower);
    if (sloganPosLower !== -1) {
      return sloganPosLower + productSlogan.length;
    }
  }

  // Try exact match for product name
  const exactPos = rawText.indexOf(productName);
  if (exactPos !== -1) {
    return exactPos + productName.length;
  }

  // Try case-insensitive match
  const nameLower = productName.toLowerCase();
  const rawTextLower = rawText.toLowerCase();
  const lowerPos = rawTextLower.indexOf(nameLower);
  if (lowerPos !== -1) {
    return lowerPos + productName.length;
  }

  // Try partial match (first 3+ words of product name)
  const words = productName.split(/\s+/).filter(w => w.length > 0);
  if (words.length >= 3) {
    const partialName = words.slice(0, 3).join(' ');
    const partialPos = rawTextLower.indexOf(partialName.toLowerCase());
    if (partialPos !== -1) {
      return partialPos + partialName.length;
    }
  }

  // Fallback: return 0 to search from start
  return 0;
}

/**
 * Find the end boundary for description extraction.
 * Returns the position where structured sections (supplement facts, ingredients, etc.) begin.
 */
function findDescriptionEndBoundary(rawText: string, startPos: number): number {
  const endMarkers = [
    ...SECTION_MARKERS.supplementFacts,
    ...SECTION_MARKERS.ingredients,
    ...SECTION_MARKERS.directions,
    ...SECTION_MARKERS.caution,
    'BENEFITS', 'Benefits:', 'FEATURES', 'Features:',
    'SUGGESTED USE', 'Suggested Use:',
    'SERVING SIZE', 'Serving Size',
    'Amount Per Serving', 'AMOUNT PER SERVING',
  ];

  let endPos = rawText.length;

  for (const marker of endMarkers) {
    const pos = rawText.indexOf(marker, startPos);
    if (pos !== -1 && pos < endPos) {
      endPos = pos;
    }
  }

  return endPos;
}

/**
 * Extract all text from a PDF file
 */
export async function extractTextFromPDF(pdfPath: string): Promise<PDFTextExtraction> {
  try {
    // Read PDF file
    const dataBuffer = await fs.readFile(pdfPath);

    // Parse PDF with unpdf (returns per-page text array)
    // unpdf requires Uint8Array, not Buffer
    const { text, totalPages } = await extractText(new Uint8Array(dataBuffer), {
      mergePages: false
    });

    return {
      success: true,
      rawText: text.join('\n'),
      pageTexts: text,
      metadata: {
        pageCount: totalPages,
        hasText: text.some(t => t.length > 0),
        hasImages: false
      }
    };
  } catch (error) {
    logger.error(`Failed to extract text from PDF: ${pdfPath}`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Extract a specific section from raw text using keyword anchors
 */
export function extractSectionByKeywords(
  rawText: string,
  startKeywords: string[],
  endKeywords: string[]
): string | null {
  // Normalize text for searching
  const normalizedText = rawText;

  // Find start position
  let startPos = -1;

  for (const keyword of startKeywords) {
    const pos = normalizedText.indexOf(keyword);
    if (pos !== -1) {
      startPos = pos + keyword.length;
      break;
    }
  }

  if (startPos === -1) {
    return null;
  }

  // Find end position
  let endPos = normalizedText.length;

  for (const keyword of endKeywords) {
    const pos = normalizedText.indexOf(keyword, startPos);
    if (pos !== -1 && pos < endPos) {
      endPos = pos;
    }
  }

  // Extract section
  const section = normalizedText.substring(startPos, endPos).trim();

  return section.length > 0 ? section : null;
}

/**
 * Extract ingredients section from raw text
 */
export function extractIngredientsText(rawText: string): string | null {
  // End keywords are the start of other sections
  const endKeywords = [
    ...SECTION_MARKERS.directions,
    ...SECTION_MARKERS.caution,
    ...SECTION_MARKERS.supplementFacts,
    'MADE IN', 'Made in', 'DISTRIBUTED BY', 'Distributed by',
    'WARNINGS', 'WARNING', 'STORE', 'Store',
    'Questions?', 'QUESTIONS?', 'For more information'
  ];

  return extractSectionByKeywords(rawText, SECTION_MARKERS.ingredients, endKeywords);
}

/**
 * Extract directions section from raw text
 */
export function extractDirectionsText(rawText: string): string | null {
  const endKeywords = [
    ...SECTION_MARKERS.ingredients,
    ...SECTION_MARKERS.caution,
    'MADE IN', 'Made in', 'DISTRIBUTED BY', 'Distributed by',
    'WARNINGS', 'WARNING', 'STORE', 'Store',
    'Questions?', 'QUESTIONS?', 'For more information'
  ];

  return extractSectionByKeywords(rawText, SECTION_MARKERS.directions, endKeywords);
}

/**
 * Extract caution/warning section from raw text
 */
export function extractCautionText(rawText: string): string | null {
  const endKeywords = [
    ...SECTION_MARKERS.directions,
    ...SECTION_MARKERS.ingredients,
    'MADE IN', 'Made in', 'DISTRIBUTED BY', 'Distributed by',
    'STORE', 'Store',
    'Questions?', 'QUESTIONS?', 'For more information',
    'KEEP OUT OF REACH', 'Keep out of reach'
  ];

  return extractSectionByKeywords(rawText, SECTION_MARKERS.caution, endKeywords);
}

/**
 * Extract product description from raw text
 * Description is usually near the top of the document, after the product name/slogan
 * and before structured sections like supplement facts or ingredients.
 */
export function extractDescriptionText(
  rawText: string,
  productName?: string,
  productSlogan?: string | null
): string | null {
  // First try explicit description section markers
  const endKeywords = [
    ...SECTION_MARKERS.supplementFacts,
    ...SECTION_MARKERS.ingredients,
    ...SECTION_MARKERS.directions,
    ...SECTION_MARKERS.caution,
    'BENEFITS', 'Benefits:', 'FEATURES', 'Features:',
    'SUPPLEMENT FACTS', 'Supplement Facts'
  ];

  const explicitDescription = extractSectionByKeywords(rawText, SECTION_MARKERS.description, endKeywords);
  if (explicitDescription && explicitDescription.length > 20) {
    return explicitDescription;
  }

  // Position-aware fallback: Search only in the bounded region after product name/slogan
  // and before structured sections
  const startPos = productName
    ? findProductNamePosition(rawText, productName, productSlogan)
    : 0;
  const endPos = findDescriptionEndBoundary(rawText, startPos);

  // Extract the bounded region for searching
  const boundedText = rawText.substring(startPos, endPos);

  // Split by double newlines to find paragraphs within the bounded region
  const paragraphs = boundedText.split(/\n\s*\n/).filter(p => p.trim().length > 30);

  // Search for a substantial paragraph that looks like a description
  for (const paragraph of paragraphs) {
    const trimmed = paragraph.trim();
    // Skip if it looks like a section header (too short)
    if (trimmed.length < 50) continue;
    // Skip if it's mostly uppercase (likely a heading)
    const upperCount = (trimmed.match(/[A-Z]/g) || []).length;
    const lowerCount = (trimmed.match(/[a-z]/g) || []).length;
    if (upperCount > lowerCount) continue;
    // Skip if it contains supplement facts markers
    if (SECTION_MARKERS.supplementFacts.some(m => trimmed.includes(m))) continue;
    // Skip if it contains ingredients markers
    if (SECTION_MARKERS.ingredients.some(m => trimmed.includes(m))) continue;
    // Skip if it contains directions markers
    if (SECTION_MARKERS.directions.some(m => trimmed.includes(m))) continue;

    // Found a good candidate
    return trimmed.substring(0, 500); // Limit to 500 chars
  }

  return null;
}

/**
 * Extract references/citations section from raw text
 * Usually appears at the bottom of the document
 */
export function extractReferencesText(rawText: string): string | null {
  const endKeywords = [
    'MADE IN', 'Made in', 'DISTRIBUTED BY', 'Distributed by',
    'MANUFACTURED', 'Manufactured', 'CONTACT', 'Contact',
    '©', 'Copyright', 'All rights reserved'
  ];

  const explicitReferences = extractSectionByKeywords(rawText, SECTION_MARKERS.references, endKeywords);
  if (explicitReferences) {
    // Clean up and limit length
    const cleaned = explicitReferences.trim().substring(0, 1000);
    return cleaned.length > 10 ? cleaned : null;
  }

  // Fallback: Look for FDA disclaimer text which often contains references
  const fdaDisclaimer = rawText.match(/\*\s*These statements have not been evaluated[\s\S]{0,500}/i);
  if (fdaDisclaimer) {
    return fdaDisclaimer[0].trim();
  }

  return null;
}

/**
 * Extract dietary attributes from raw text
 * Looks for common dietary markers like Vegan, Gluten-Free, etc.
 */
export function extractDietaryAttributesText(rawText: string): string[] {
  const attributes: string[] = [];

  // Define attribute patterns and their normalized names
  const attributePatterns: Array<{ pattern: RegExp; name: string }> = [
    { pattern: /\bvegan\b/i, name: 'vegan' },
    { pattern: /\bvegetarian\b/i, name: 'vegetarian' },
    { pattern: /\bgluten[- ]?free\b/i, name: 'gluten-free' },
    { pattern: /\bdairy[- ]?free\b/i, name: 'dairy-free' },
    { pattern: /\bnon[- ]?gmo\b/i, name: 'non-GMO' },
    { pattern: /\bkosher\b/i, name: 'kosher' },
    { pattern: /\bhalal\b/i, name: 'halal' },
    { pattern: /\bsoy[- ]?free\b/i, name: 'soy-free' },
    { pattern: /\bsugar[- ]?free\b/i, name: 'sugar-free' },
    { pattern: /\borganic\b/i, name: 'organic' },
    { pattern: /\bnut[- ]?free\b/i, name: 'nut-free' },
    { pattern: /\begg[- ]?free\b/i, name: 'egg-free' },
    { pattern: /\bpaleo\b/i, name: 'paleo' },
    { pattern: /\bketo\b/i, name: 'keto' },
    { pattern: /\braw\b/i, name: 'raw' },
    { pattern: /\bwhole[- ]?food\b/i, name: 'whole-food' },
  ];

  // Check for checkmark symbols followed by text
  const checkmarkPatterns = rawText.match(/[✓✔☑]\s*([A-Za-z][A-Za-z\s-]{2,20})/g);
  if (checkmarkPatterns) {
    checkmarkPatterns.forEach(match => {
      const text = match.replace(/[✓✔☑]\s*/, '').trim().toLowerCase();
      // Check if this matches any known attribute
      for (const { pattern, name } of attributePatterns) {
        if (pattern.test(text) && !attributes.includes(name)) {
          attributes.push(name);
        }
      }
    });
  }

  // Also check for attributes mentioned anywhere in the text
  for (const { pattern, name } of attributePatterns) {
    if (pattern.test(rawText) && !attributes.includes(name)) {
      attributes.push(name);
    }
  }

  return attributes;
}

/**
 * Extract all text sections from a PDF
 * @param pdfPath - Path to the PDF file
 * @param productName - Optional product name to anchor description extraction
 * @param productSlogan - Optional product slogan for more precise anchoring
 */
export async function extractAllSections(
  pdfPath: string,
  productName?: string,
  productSlogan?: string | null
): Promise<{
  success: boolean;
  ingredients?: string | null;
  directions?: string | null;
  caution?: string | null;
  description?: string | null;
  references?: string | null;
  dietaryAttributes?: string[];
  rawText?: string;
  error?: string;
}> {
  const textExtraction = await extractTextFromPDF(pdfPath);

  if (!textExtraction.success || !textExtraction.rawText) {
    return {
      success: false,
      error: textExtraction.error || 'No text extracted'
    };
  }

  const rawText = textExtraction.rawText;

  return {
    success: true,
    ingredients: extractIngredientsText(rawText),
    directions: extractDirectionsText(rawText),
    caution: extractCautionText(rawText),
    description: extractDescriptionText(rawText, productName, productSlogan),
    references: extractReferencesText(rawText),
    dietaryAttributes: extractDietaryAttributesText(rawText),
    rawText
  };
}
