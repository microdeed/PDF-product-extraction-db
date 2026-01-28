import { z } from 'zod';

// Schema for individual nutrients in supplement facts
export const nutrientSchema = z.object({
  name: z.string().min(1),
  amount: z.string()
    .regex(/^<?[\d.]+\s*[a-zA-Z]+/, "Amount must include number and unit (e.g., '100 mg', '<1 g')")
    .nullable()
    .optional(),
  dailyValuePercentAdult: z.string()
    .regex(/^<?[\d.]+$/, "Daily value percent must be numeric")
    .nullable()
    .optional(),
  dailyValuePercentChildren: z.string()
    .regex(/^<?[\d.]+$/, "Daily value percent must be numeric")
    .nullable()
    .optional(),
  // Backward compatibility with old single DV% field
  dailyValuePercent: z.string().nullable().optional(),
});

// Schema for supplement facts section
export const supplementFactsSchema = z.object({
  servings: z.string().min(1),
  servingsPerContainer: z.string().min(1),
  calories: z.string().nullable().optional(),
  protein: z.string().nullable().optional(),
  nutrients: z.array(nutrientSchema).default([]),
});

// Schema for ingredients
export const ingredientSchema = z.object({
  name: z.string().min(1),
  isOrganic: z.boolean().default(false),
});

// Main product extraction schema - matches AI response format
export const productExtractionSchema = z.object({
  productName: z.string().min(1),
  productSlogan: z.string().nullable().optional(),
  productDescription: z.string().min(1),
  subbrand: z.string().nullable().optional(),
  supplementFacts: supplementFactsSchema.optional(),
  ingredients: z.array(ingredientSchema).default([]),
  directions: z.string().min(1),
  caution: z.string().nullable().optional(),
  dietaryAttributes: z.array(z.string()).default([]),
  references: z.string().nullable().optional(),
});

// Type exports
export type NutrientData = z.infer<typeof nutrientSchema>;
export type SupplementFactsData = z.infer<typeof supplementFactsSchema>;
export type IngredientData = z.infer<typeof ingredientSchema>;
export type ProductExtractionData = z.infer<typeof productExtractionSchema>;

// Validation function with detailed error reporting
export function validateProductExtraction(data: unknown): {
  success: boolean;
  data?: ProductExtractionData;
  error?: string;
} {
  try {
    const validated = productExtractionSchema.parse(data);
    return { success: true, data: validated };
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errorMessages = error.errors.map((err) => `${err.path.join('.')}: ${err.message}`);
      return {
        success: false,
        error: `Validation failed:\n${errorMessages.join('\n')}`,
      };
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown validation error',
    };
  }
}

// Quick validation before full schema parse
// Checks if data is likely a valid product extraction without running full Zod validation
export function isLikelyProductExtraction(data: unknown): boolean {
  if (typeof data !== 'object' || data === null) {
    return false;
  }

  const obj = data as Record<string, unknown>;

  // Must have core fields
  const requiredFields = ['productName', 'productDescription'];
  const hasRequired = requiredFields.every(
    (field) => typeof obj[field] === 'string' && (obj[field] as string).length > 0
  );

  // Should have at least one of these
  const expectedFields = ['supplementFacts', 'ingredients', 'directions'];
  const hasExpected = expectedFields.some((field) => obj[field] !== undefined);

  return hasRequired && hasExpected;
}

// Quick validation for supplement facts only (used in hybrid extraction)
export function isLikelySupplementFacts(data: unknown): boolean {
  if (typeof data !== 'object' || data === null) {
    return false;
  }

  const obj = data as Record<string, unknown>;

  // Must have servings info and nutrients array
  const hasServings = typeof obj['servings'] === 'string' && (obj['servings'] as string).length > 0;
  const hasServingsPerContainer = typeof obj['servingsPerContainer'] === 'string';
  const hasNutrients = Array.isArray(obj['nutrients']);

  return hasServings && hasServingsPerContainer && hasNutrients;
}

// Quick validation for text structuring output (ingredients/directions/caution)
export function isLikelyTextStructuring(data: unknown): boolean {
  if (typeof data !== 'object' || data === null) {
    return false;
  }

  const obj = data as Record<string, unknown>;

  // Must have ingredients array OR directions
  const hasIngredients = Array.isArray(obj['ingredients']);
  const hasDirections = typeof obj['directions'] === 'string';

  return hasIngredients || hasDirections;
}

// Quick validation for full product fields (description, slogan, dietary, references)
export function isLikelyFullProduct(data: unknown): boolean {
  if (typeof data !== 'object' || data === null) {
    return false;
  }

  const obj = data as Record<string, unknown>;

  // Must have at least productDescription or dietaryAttributes
  const hasDescription = typeof obj['productDescription'] === 'string' && (obj['productDescription'] as string).length > 0;
  const hasDietaryAttributes = Array.isArray(obj['dietaryAttributes']);

  // Optional fields that indicate this is the right structure
  const hasSlogan = obj['productSlogan'] !== undefined;
  const hasReferences = obj['references'] !== undefined;
  const hasSubbrand = obj['subbrand'] !== undefined;

  // Must have description or dietary attributes, plus at least one optional field
  return (hasDescription || hasDietaryAttributes) && (hasSlogan || hasReferences || hasSubbrand || hasDietaryAttributes);
}

// Safe parse that returns partial data even on validation failure
export function safeParseProductExtraction(data: unknown): ProductExtractionData | null {
  try {
    return productExtractionSchema.parse(data);
  } catch (error) {
    // Attempt to extract what we can, PRESERVING supplement facts if present
    if (typeof data === 'object' && data !== null) {
      const partial = data as Record<string, unknown>;

      // Attempt to salvage supplement facts even if validation fails
      let supplementFacts: SupplementFactsData | undefined = undefined;
      if (typeof partial.supplementFacts === 'object' && partial.supplementFacts !== null) {
        const sfPartial = partial.supplementFacts as Record<string, unknown>;
        try {
          supplementFacts = supplementFactsSchema.parse(sfPartial);
        } catch {
          // Try to salvage at least the nutrients
          if (Array.isArray(sfPartial.nutrients)) {
            supplementFacts = {
              servings: typeof sfPartial.servings === 'string' ? sfPartial.servings : '1',
              servingsPerContainer: typeof sfPartial.servingsPerContainer === 'string' ? sfPartial.servingsPerContainer : '1',
              calories: typeof sfPartial.calories === 'string' ? sfPartial.calories : null,
              protein: typeof sfPartial.protein === 'string' ? sfPartial.protein : null,
              nutrients: sfPartial.nutrients.filter((n): n is z.infer<typeof nutrientSchema> => {
                return typeof n === 'object' && n !== null &&
                       typeof (n as Record<string, unknown>).name === 'string';
              }).map((n) => {
                const nutrient = n as Record<string, unknown>;
                return {
                  name: nutrient.name as string,
                  amount: typeof nutrient.amount === 'string' ? nutrient.amount : null,
                  dailyValuePercentAdult: typeof nutrient.dailyValuePercentAdult === 'string' ? nutrient.dailyValuePercentAdult :
                                         typeof nutrient.dailyValuePercent === 'string' ? nutrient.dailyValuePercent : null,
                  dailyValuePercentChildren: typeof nutrient.dailyValuePercentChildren === 'string' ? nutrient.dailyValuePercentChildren : null,
                };
              }),
            };
          }
        }
      }

      return {
        productName: typeof partial.productName === 'string' ? partial.productName : 'Unknown',
        productSlogan: typeof partial.productSlogan === 'string' ? partial.productSlogan : null,
        productDescription: typeof partial.productDescription === 'string' ? partial.productDescription : 'No description available',
        subbrand: typeof partial.subbrand === 'string' ? partial.subbrand : null,
        supplementFacts,
        ingredients: [],
        directions: typeof partial.directions === 'string' ? partial.directions : 'No directions provided',
        caution: typeof partial.caution === 'string' ? partial.caution : null,
        dietaryAttributes: [],
        references: typeof partial.references === 'string' ? partial.references : null,
      };
    }
    return null;
  }
}
