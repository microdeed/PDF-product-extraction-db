import { PDFFileMetadata } from '../scanner/file-parser.js';

// Known subbrands - product line names that appear in logo/branding areas
// These are proper nouns representing brand divisions, NOT marketing slogans
export const KNOWN_SUBBRANDS = [
  'Solis',
  'Be Sports Nutrition',
  'California',
  'Revive CBD',
] as const;

export interface ExtractionPrompt {
  system: string;
  user: string;
}

// Build the extraction prompt for Claude Vision API
export function buildExtractionPrompt(metadata: PDFFileMetadata): ExtractionPrompt {
  const system = `You are a precise data extraction specialist. Your task is to extract product information from PDF product information sheets.

Extract data exactly as it appears in the document. Do not make assumptions or infer information that is not explicitly stated.

CRITICAL: Return ONLY the JSON object, nothing else. No explanations, no preamble, no postamble.
Do not include phrases like "Here is the extracted data" or "I hope this helps".
Start your response with { and end with }. No other text before or after.

CRITICAL JSON FORMATTING RULES:
- All string values MUST properly escape special characters
- Newlines: Use \\n (NOT actual newline characters)
- Quotes: Use \\" (NOT unescaped " characters)
- Backslashes: Use \\\\ (escape the backslash itself)
- Tabs: Use \\t (NOT actual tab characters)
- For long text fields (especially "references"), keep under 1000 characters
- If text contains many citations, truncate with "..." and note truncation
- Validate your JSON is properly formatted before responding (matching quotes, balanced braces)
- Never leave strings unterminated or quotes unescaped

Return valid JSON matching this exact structure:

{
  "productName": "string",
  "productSlogan": "string or null",
  "productDescription": "string",
  "subbrand": "string or null",
  "supplementFacts": {
    "servings": "string (e.g., '2 gummy bears')",
    "servingsPerContainer": "string (e.g., '30')",
    "calories": "string or null (e.g., '10')",
    "protein": "string or null (e.g., '0 g')",
    "nutrients": [
      {
        "name": "string (full nutrient name)",
        "amount": "string with number and unit (e.g., '100 mg', '<1 g') or null if missing",
        "dailyValuePercentAdult": "string (numeric only, e.g., '100') or null",
        "dailyValuePercentChildren": "string (numeric only, e.g., '150') or null"
      }
    ]
  },
  "ingredients": [
    {
      "name": "string",
      "isOrganic": boolean
    }
  ],
  "directions": "string",
  "caution": "string or null",
  "dietaryAttributes": ["array of strings like vegan, gluten-free, etc."],
  "references": "string or null"
}

CRITICAL: SUBBRAND vs PRODUCT SLOGAN DIFFERENTIATION

These are DIFFERENT fields - do not confuse them:

SUBBRAND (product line name):
- A sub-brand or product line name (proper noun)
- Appears in logo area or as part of brand identity
- Examples: "Solis", "Be Sports Nutrition", "California", "Revive CBD"
- Known subbrands: ${KNOWN_SUBBRANDS.join(', ')}
- If folder metadata includes subbrand, verify it matches what you see

PRODUCT SLOGAN (marketing tagline):
- A marketing phrase describing product benefits
- Appears DIRECTLY AFTER the product name (not in logo area)
- Contains action words or benefit descriptions
- Examples: "Supports Healthy Bones", "Energy & Focus", "Promotes Restful Sleep"

QUICK TEST:
- Does it sound like a brand/company name? → subbrand
- Does it describe what the product does or its benefits? → productSlogan

CRITICAL RULES FOR SUPPLEMENT FACTS:
- Amount Format: MUST include both number and unit (e.g., "100 mg", "2.5 g", "<1 mg")
- If amount is marked with "*", "†", "-" or missing: set to null
- NEVER use "0" for missing amounts - use null instead

Daily Value Percentages:
- For adult-only products: only populate dailyValuePercentAdult, set dailyValuePercentChildren to null
- For children's products with dual percentages: populate BOTH fields
  Example: "Vitamin C 100mg (100% adult, 200% children)"
  → dailyValuePercentAdult: "100", dailyValuePercentChildren: "200"
- If only one percentage is shown, assume it's adult and populate dailyValuePercentAdult only
- Store ONLY the numeric value without "%" symbol (e.g., "100" not "100%")
- If percentage is marked with "*", "†", "-" or missing: set to null

Nutrient Names:
- Extract complete nutrient names including forms (e.g., "Vitamin B12 (as Methylcobalamin)")
- Preserve unit context (e.g., "mg RAE", "mg α-TE", "mcg DFE")

General Rules:
- Extract text verbatim from the PDF
- For ingredients, set isOrganic to true only if explicitly labeled as organic
- Include all nutrients from the supplement facts table in order
- Dietary attributes include: vegan, vegetarian, gluten-free, dairy-free, non-GMO, organic, kosher, halal, sugar-free, soy-free
- If a field is not present in the PDF, use null
- NEVER fabricate or guess missing data`;

  const user = `Extract all product information from this product information sheet.

Product Code: ${metadata.productCode}
Expected Product Name: ${metadata.productName}
${metadata.subbrand ? `Subbrand: ${metadata.subbrand}` : ''}

Please extract:
1. Product name, slogan, and description
2. All supplement facts including serving size and nutritional values
3. Complete ingredients list (mark organic ingredients)
4. Directions for use
5. Caution/warning statements
6. Any dietary attributes (vegan, gluten-free, etc.)
7. References or citations if present

Return the data as JSON matching the exact structure specified in the system prompt.`;

  return { system, user };
}

// Build a simplified prompt for retry attempts (if full extraction failed)
export function buildSimplifiedPrompt(metadata: PDFFileMetadata): ExtractionPrompt {
  const system = `You are a data extraction specialist. Extract product information from this PDF, focusing on clarity and valid JSON output.

Return valid JSON with this structure:
{
  "productName": "string",
  "productDescription": "string",
  "supplementFacts": {
    "servings": "string",
    "servingsPerContainer": "string",
    "calories": "string or null",
    "protein": "string or null",
    "nutrients": [
      {
        "name": "string",
        "amount": "string with number and unit or null",
        "dailyValuePercentAdult": "string or null",
        "dailyValuePercentChildren": "string or null"
      }
    ]
  },
  "ingredients": [{"name": "string", "isOrganic": false}],
  "directions": "string",
  "productSlogan": null,
  "subbrand": null,
  "caution": null,
  "references": null,
  "dietaryAttributes": []
}

IMPORTANT RULES:
- Amount must include number and unit (e.g., "100 mg") or be null
- NEVER use "0" for missing amounts
- For adult-only products: populate only dailyValuePercentAdult
- For children's products: populate both dailyValuePercentAdult and dailyValuePercentChildren when dual percentages are shown
- Store daily value percentages as numbers without "%" symbol

CRITICAL JSON FORMATTING:
- Escape all special characters in strings: \\n for newlines, \\" for quotes, \\\\ for backslashes
- NEVER include actual newline characters in string values
- Keep all string fields under 1000 characters
- Ensure all strings are properly terminated with closing quotes
- Validate JSON structure before responding (balanced braces, proper commas)`;

  const user = `Extract product information from this product sheet for product code ${metadata.productCode}.

IMPORTANT: Return ONLY the JSON object. Start with { and end with }.
Do not add any explanatory text before or after the JSON.`;

  return { system, user };
}

// Build verification prompt to check extracted data quality
export function buildVerificationPrompt(extractedData: string): string {
  return `Review this extracted product data and verify:
1. All required fields are present
2. Data appears accurate and complete
3. No obvious errors or inconsistencies

Extracted data:
${extractedData}

Respond with: "VERIFIED" if data looks good, or list any issues found.`;
}

// Build prompt for extracting ONLY supplement facts (for hybrid approach)
export function buildSupplementFactsOnlyPrompt(metadata: PDFFileMetadata): ExtractionPrompt {
  const system = `You are a nutritional facts extraction specialist. Extract ONLY the supplement facts table from this PDF.

CRITICAL: Return ONLY the JSON object. No explanations. Start with { and end with }.

JSON FORMATTING REQUIREMENTS:
- Properly escape all special characters: \\n for newlines, \\" for quotes, \\\\ for backslashes
- NEVER use actual newline characters in string values
- All strings must be properly terminated with closing quotes
- Validate JSON structure (balanced braces, proper commas)

Return this exact structure:
{
  "servings": "string (e.g., '2 capsules')",
  "servingsPerContainer": "string (e.g., '30')",
  "calories": "string or null (e.g., '10')",
  "protein": "string or null (e.g., '0 g')",
  "nutrients": [
    {
      "name": "complete nutrient name with form",
      "amount": "number with unit (e.g., '100 mg') or null",
      "dailyValuePercentAdult": "numeric string (e.g., '100') or null",
      "dailyValuePercentChildren": "numeric string or null"
    }
  ]
}

EXTRACTION RULES:
- Amount: MUST include number and unit (e.g., "100 mg", "2.5 g", "<1 g") or null if missing/marked
- If amount is marked with "*", "†", "-" or missing: set to null
- NEVER use "0" for amounts - use null instead
- Daily Value: Numeric only, no "%" symbol (e.g., "100" not "100%")
- For dual percentages (adult/children): populate BOTH fields
- Extract nutrients in order as shown in table
- Include nutrient forms: "Vitamin B12 (as Methylcobalamin)"
- Preserve unit context: "mg RAE", "mg α-TE", "mcg DFE"`;

  const user = `Extract the supplement facts table from product ${metadata.productCode}.

Focus ONLY on the supplement facts / nutritional information table. Ignore all other text.

Return JSON starting with { and ending with }. No other text.`;

  return { system, user };
}

// Build prompt for extracting full product fields (for hybrid approach)
// This extracts fields like description, slogan, dietary attributes, references
// (NOT supplement facts - those are extracted separately)
export function buildFullProductPrompt(metadata: PDFFileMetadata): ExtractionPrompt {
  const system = `You are a precise data extraction specialist. Extract product metadata from this PDF.

CRITICAL: Extract text EXACTLY as it appears in the document. Do NOT summarize, paraphrase, edit, or rewrite any text.
Copy text verbatim - preserve exact wording, punctuation, and formatting.

CRITICAL: Return ONLY the JSON object. No explanations. Start with { and end with }.

JSON FORMATTING REQUIREMENTS:
- Properly escape special characters: \\n for newlines, \\" for quotes, \\\\ for backslashes
- NEVER use actual newline characters in string values
- All strings must be properly terminated
- Keep references field under 1000 characters (truncate with "..." if needed)

Return this exact structure:
{
  "productDescription": "string (verbatim from PDF) or null",
  "productSlogan": "string (verbatim from PDF) or null",
  "subbrand": "string (verbatim from PDF) or null",
  "dietaryAttributes": ["array of strings - exact text as shown"],
  "references": "string (verbatim from PDF) or null"
}

EXTRACTION RULES - VERBATIM ONLY:

Product Description:
- Copy the exact introductory/descriptive text about the product
- Do NOT summarize or rewrite - extract word-for-word
- If no description text exists, return null

CRITICAL: SUBBRAND vs PRODUCT SLOGAN - These are DIFFERENT fields!

SUBBRAND (product line name):
- A sub-brand or product line name (proper noun)
- Appears in LOGO AREA or as part of brand identity (usually top of page)
- Known subbrands: ${KNOWN_SUBBRANDS.join(', ')}
- Examples: "Solis", "Be Sports Nutrition", "California", "Revive CBD"
- If folder metadata indicates a subbrand, verify it matches what you see in the logo/branding
- Return null if no subbrand is visible in logo/branding area

PRODUCT SLOGAN (marketing tagline about benefits):
- A marketing phrase describing what the product DOES or its BENEFITS
- Appears DIRECTLY AFTER the product name (NOT in logo area)
- Contains action words or benefit descriptions
- Examples: "Supports Healthy Bones", "Energy & Focus", "Promotes Restful Sleep", "Calcium & Magnesium Promote Healthy Bones"
- Return null if no benefit tagline appears after the product name

QUICK TEST to decide which field:
- Does it sound like a brand/company name? → subbrand
- Does it describe what the product does? → productSlogan
- Is it in the logo/branding area? → subbrand
- Is it right after the product name describing benefits? → productSlogan

Dietary Attributes:
- Copy the exact text of each dietary claim (e.g., "Gluten-Free", "Non-GMO Verified")
- Only include attributes explicitly shown on the document
- Return empty array [] if none found

References:
- Copy citations, footnotes, or FDA disclaimers verbatim
- Truncate with "..." if over 1000 characters
- Return null if none found

NEVER fabricate, summarize, or infer content. If text is not explicitly present, use null.`;

  const user = `Extract product metadata VERBATIM from this product sheet for ${metadata.productCode} (${metadata.productName}).
${metadata.subbrand ? `\nFolder metadata indicates subbrand: "${metadata.subbrand}" - verify this matches what you see in logo/branding area.` : ''}

IMPORTANT: Copy all text exactly as it appears. Do NOT edit, summarize, or paraphrase.

Extract:
1. Product description (exact text)
2. Product slogan - benefit tagline that appears AFTER product name (e.g., "Supports Healthy Bones")
3. Subbrand - brand/line name from LOGO AREA only (known: ${KNOWN_SUBBRANDS.join(', ')})
4. Dietary attributes (exact text of each)
5. References (exact text)

REMINDER: Subbrand = brand name in logo. Slogan = benefit description after product name. Do NOT confuse them.

Return null for any field not found in the document.

Return JSON starting with { and ending with }. No other text.`;

  return { system, user };
}

// Build prompt for structuring extracted text into JSON (minimal AI processing)
export function buildTextStructuringPrompt(textData: {
  ingredientsText: string | null;
  directionsText: string | null;
  cautionText: string | null;
  productName: string;
  productCode: string;
}): string {
  return `Convert this raw extracted text into structured JSON. Preserve text EXACTLY as given - no modifications.

RAW TEXT:
Ingredients: ${textData.ingredientsText || 'Not found'}
Directions: ${textData.directionsText || 'Not found'}
Caution: ${textData.cautionText || 'Not found'}

Return this JSON structure:
{
  "ingredients": [{"name": "ingredient name", "isOrganic": boolean}],
  "directions": "directions text",
  "caution": "caution text or null"
}

CRITICAL RULES FOR INGREDIENTS:
- Split ingredient text by commas
- Each comma-separated item becomes a separate ingredient
- Set isOrganic=true ONLY if "organic" or "bio" appears immediately before ingredient name
- Preserve ingredient names exactly, including parentheses and forms
- Maintain order as given
- Example: "Organic Sugar, Gelatin, Citric Acid" →
  [{"name": "Sugar", "isOrganic": true}, {"name": "Gelatin", "isOrganic": false}, {"name": "Citric Acid", "isOrganic": false}]

RULES FOR TEXT FIELDS:
- Copy text exactly as provided
- Do not add punctuation or modify formatting
- If text not found, use null
- Preserve special characters and spacing

Return ONLY the JSON object. No explanations. Start with { and end with }.`;
}
