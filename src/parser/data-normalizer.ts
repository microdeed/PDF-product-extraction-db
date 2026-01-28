import { ProductExtractionData, IngredientData } from './json-validator.js';
import logger from '../utils/logger.js';

// Normalize whitespace and remove extra spaces
function normalizeWhitespace(text: string | null | undefined): string | null {
  if (!text) return null;
  return text.trim().replace(/\s+/g, ' ');
}

// Sanitize references field to prevent downstream issues
function sanitizeReferencesField(references: string | null | undefined): string | null {
  if (!references) return null;

  let sanitized = references;

  // Remove actual newlines (replace with spaces)
  sanitized = sanitized.replace(/\r?\n/g, ' ');

  // Collapse multiple spaces
  sanitized = sanitized.replace(/\s+/g, ' ').trim();

  // Truncate if too long (5000 character limit)
  const maxLength = 5000;
  if (sanitized.length > maxLength) {
    logger.warn(`References field truncated from ${sanitized.length} to ${maxLength} characters`);
    sanitized = sanitized.substring(0, maxLength - 3) + '...';
  }

  return sanitized;
}

// Normalize product name - capitalize properly
function normalizeProductName(name: string): string {
  return normalizeWhitespace(name) || 'Unknown Product';
}

// Normalize description - ensure proper punctuation
function normalizeDescription(description: string): string {
  const normalized = normalizeWhitespace(description) || 'No description available';
  // Ensure ends with punctuation
  if (!/[.!?]$/.test(normalized)) {
    return normalized + '.';
  }
  return normalized;
}

// Parse organic flag from ingredient name
function parseOrganicFlag(ingredientName: string): { name: string; isOrganic: boolean } {
  const lowerName = ingredientName.toLowerCase();
  const isOrganic = /\b(organic|bio)\b/.test(lowerName);

  // Remove organic prefix if present
  let cleanName = ingredientName
    .replace(/^\s*(organic|bio)\s+/i, '')
    .trim();

  return {
    name: normalizeWhitespace(cleanName) || ingredientName,
    isOrganic: isOrganic || false,
  };
}

// Normalize ingredients list
function normalizeIngredients(ingredients: IngredientData[]): IngredientData[] {
  return ingredients.map((ingredient) => {
    const parsed = parseOrganicFlag(ingredient.name);
    return {
      name: parsed.name,
      isOrganic: ingredient.isOrganic || parsed.isOrganic,
    };
  });
}

// Normalize dietary attributes - standardize naming
function normalizeDietaryAttributes(attributes: string[]): string[] {
  const standardized = attributes.map((attr) => {
    const lower = attr.toLowerCase().trim();

    // Standardize common variations
    const mapping: Record<string, string> = {
      'vegan': 'Vegan',
      'vegetarian': 'Vegetarian',
      'gluten-free': 'Gluten-Free',
      'gluten free': 'Gluten-Free',
      'dairy-free': 'Dairy-Free',
      'dairy free': 'Dairy-Free',
      'non-gmo': 'Non-GMO',
      'non gmo': 'Non-GMO',
      'organic': 'Organic',
      'kosher': 'Kosher',
      'halal': 'Halal',
      'sugar-free': 'Sugar-Free',
      'sugar free': 'Sugar-Free',
      'soy-free': 'Soy-Free',
      'soy free': 'Soy-Free',
    };

    return mapping[lower] || attr.trim();
  });

  // Remove duplicates
  return [...new Set(standardized)];
}

// Normalize serving information
function normalizeServing(serving: string): string {
  return normalizeWhitespace(serving) || 'Not specified';
}

// Normalize nutrient amount - ensure consistent format
function normalizeNutrientAmount(amount: string | null | undefined): string | null {
  if (!amount) return null;
  const normalized = normalizeWhitespace(amount);
  if (!normalized) return null;

  // Check for invalid values
  if (['0', 'unknown', 'N/A', 'n/a', '-'].includes(normalized)) {
    return null;
  }

  // Ensure space between number and unit (e.g., "100mg" -> "100 mg")
  return normalized.replace(/(\d)([a-zA-Z])/g, '$1 $2');
}

// Normalize daily value percentage - extract numeric value
function normalizeDailyValuePercent(percent: string | null | undefined): string | null {
  if (!percent) return null;
  const normalized = normalizeWhitespace(percent);
  if (!normalized) return null;

  // Remove % sign if present
  const cleaned = normalized.replace(/%/g, '').trim();

  // Check for invalid values
  if (['0', 'unknown', 'N/A', 'n/a', '-', '*', '†'].includes(cleaned)) {
    return null;
  }

  // Validate numeric (allow < prefix for trace amounts)
  if (!/^<?[\d.]+$/.test(cleaned)) {
    return null;
  }

  return cleaned;
}

// Normalization options
export interface NormalizationOptions {
  strict?: boolean; // If true, minimal normalization to preserve original text
  preserveOriginal?: boolean; // If true, store both original and normalized
}

// Main normalization function
export function normalizeProductData(
  data: ProductExtractionData,
  options: NormalizationOptions = {}
): ProductExtractionData {
  const { strict = false, preserveOriginal: _preserveOriginal = false } = options;

  if (strict) {
    // Strict mode: minimal normalization, preserve original text
    const strictNormalized: ProductExtractionData = {
      productName: data.productName.trim(),
      productSlogan: data.productSlogan?.trim() || null,
      productDescription: data.productDescription.trim(),
      subbrand: data.subbrand?.trim() || null,
      directions: data.directions.trim(),
      caution: data.caution?.trim() || null,
      references: sanitizeReferencesField(data.references),
      ingredients: (data.ingredients || []).map(ing => ({
        name: ing.name.trim(),
        isOrganic: ing.isOrganic
      })),
      dietaryAttributes: data.dietaryAttributes || [],
    };

    // Preserve supplement facts with minimal normalization
    if (data.supplementFacts) {
      strictNormalized.supplementFacts = {
        servings: data.supplementFacts.servings.trim(),
        servingsPerContainer: data.supplementFacts.servingsPerContainer.trim(),
        calories: data.supplementFacts.calories?.trim() || null,
        protein: data.supplementFacts.protein?.trim() || null,
        nutrients: data.supplementFacts.nutrients // Don't filter nulls in strict mode
      };
    }

    return strictNormalized;
  }

  // Standard normalization (existing logic)
  const normalized: ProductExtractionData = {
    productName: normalizeProductName(data.productName),
    productSlogan: normalizeWhitespace(data.productSlogan),
    productDescription: normalizeDescription(data.productDescription),
    subbrand: normalizeWhitespace(data.subbrand),
    directions: normalizeDescription(data.directions),
    caution: normalizeWhitespace(data.caution),
    references: sanitizeReferencesField(data.references),
    ingredients: normalizeIngredients(data.ingredients || []),
    dietaryAttributes: normalizeDietaryAttributes(data.dietaryAttributes || []),
  };

  // Normalize supplement facts if present
  if (data.supplementFacts) {
    normalized.supplementFacts = {
      servings: normalizeServing(data.supplementFacts.servings),
      servingsPerContainer: normalizeServing(data.supplementFacts.servingsPerContainer),
      calories: normalizeWhitespace(data.supplementFacts.calories),
      protein: normalizeWhitespace(data.supplementFacts.protein),
      nutrients: (data.supplementFacts.nutrients || [])
        .map((nutrient) => ({
          name: normalizeWhitespace(nutrient.name) || 'Unknown',
          amount: normalizeNutrientAmount(nutrient.amount),
          dailyValuePercentAdult: normalizeDailyValuePercent(
            nutrient.dailyValuePercentAdult || nutrient.dailyValuePercent
          ),
          dailyValuePercentChildren: normalizeDailyValuePercent(nutrient.dailyValuePercentChildren),
        }))
        .filter(n => n.amount !== null), // Skip nutrients with no valid amount
    };
  }

  return normalized;
}

// Validate data completeness
export interface DataCompletenessReport {
  isComplete: boolean;
  missingFields: string[];
  completenessPercent: number;
}

export function checkDataCompleteness(data: ProductExtractionData): DataCompletenessReport {
  const requiredFields = [
    'productName',
    'productDescription',
    'directions',
  ];

  const optionalFields = [
    'productSlogan',
    'subbrand',
    'caution',
    'references',
    'supplementFacts',
    'ingredients',
    'dietaryAttributes',
  ];

  const missingFields: string[] = [];

  // Check required fields
  for (const field of requiredFields) {
    const value = data[field as keyof ProductExtractionData];
    if (!value || (typeof value === 'string' && value.trim() === '')) {
      missingFields.push(field);
    }
  }

  // Check optional but important fields
  let presentOptionalFields = 0;
  for (const field of optionalFields) {
    const value = data[field as keyof ProductExtractionData];
    if (value && (typeof value !== 'string' || value.trim() !== '')) {
      presentOptionalFields++;
    }
  }

  const totalFields = requiredFields.length + optionalFields.length;
  const presentFields = requiredFields.length - missingFields.length + presentOptionalFields;
  const completenessPercent = Math.round((presentFields / totalFields) * 100);

  return {
    isComplete: missingFields.length === 0 && presentOptionalFields >= 3,
    missingFields,
    completenessPercent,
  };
}
