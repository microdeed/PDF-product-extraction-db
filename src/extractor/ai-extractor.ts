import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/env.js';
import { PDFFileMetadata } from '../scanner/file-parser.js';
import { convertPDFToBase64, validatePDF } from './pdf-converter.js';
import { buildExtractionPrompt, buildSimplifiedPrompt, buildSupplementFactsOnlyPrompt, buildTextStructuringPrompt, buildFullProductPrompt } from './prompt-builder.js';
import {
  validateProductExtraction,
  ProductExtractionData,
  safeParseProductExtraction,
  isLikelySupplementFacts,
  isLikelyTextStructuring,
  isLikelyFullProduct,
} from '../parser/json-validator.js';
import { normalizeProductData } from '../parser/data-normalizer.js';
import logger, { logApiRequest, logApiResponse } from '../utils/logger.js';
import { extractAllStrategies } from './json-extractor.js';
import { extractAllSections } from './text-extractor.js';
import fs from 'fs';
import path from 'path';

export interface ValidationWarning {
  fieldPath: string;
  message: string;
  severity: 'low' | 'medium' | 'high';
}

export interface ExtractionResult {
  success: boolean;
  data?: ProductExtractionData;
  rawResponse?: string;
  error?: string;
  processingTimeMs: number;
  retryCount: number;
  validationWarnings?: ValidationWarning[];
}

export class AIExtractor {
  private client: Anthropic;
  private rateLimiter: RateLimiter;

  constructor() {
    this.client = new Anthropic({
      apiKey: env.ANTHROPIC_API_KEY,
    });
    this.rateLimiter = new RateLimiter(env.RATE_LIMIT_PER_MINUTE);
  }

  async extractProductInfo(
    metadata: PDFFileMetadata,
    retryCount = 0
  ): Promise<ExtractionResult> {
    const startTime = Date.now();

    try {
      logApiRequest(metadata.productCode, metadata.filePath);

      // Validate PDF first
      const validation = await validatePDF(metadata.filePath);
      if (!validation.isValid) {
        return {
          success: false,
          error: `Invalid PDF: ${validation.error}`,
          processingTimeMs: Date.now() - startTime,
          retryCount,
        };
      }

      // Convert PDF to base64
      const conversionResult = await convertPDFToBase64(metadata.filePath);
      if (!conversionResult.success) {
        return {
          success: false,
          error: `PDF conversion failed: ${conversionResult.error}`,
          processingTimeMs: Date.now() - startTime,
          retryCount,
        };
      }

      // Wait for rate limiter
      await this.rateLimiter.acquire();

      // Build prompt
      const prompt = retryCount > 0
        ? buildSimplifiedPrompt(metadata)
        : buildExtractionPrompt(metadata);

      // Call Anthropic Vision API
      // Note: PDFs are supported by the API but TypeScript definitions don't include them yet
      // Using type assertion to bypass outdated type definitions
      const response = await this.client.messages.create({
        model: env.AI_MODEL,
        max_tokens: env.AI_MAX_TOKENS,
        temperature: env.AI_TEMPERATURE,
        system: prompt.system,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'document',
                source: {
                  type: 'base64',
                  media_type: 'application/pdf',
                  data: conversionResult.base64Data!,
                },
              },
              {
                type: 'text',
                text: prompt.user,
              },
            ] as any, // Type assertion for PDF support
          },
        ],
      });

      // Extract text response
      const textContent = response.content.find((block) => block.type === 'text');
      if (!textContent || textContent.type !== 'text') {
        return {
          success: false,
          error: 'No text content in API response',
          processingTimeMs: Date.now() - startTime,
          retryCount,
        };
      }

      const rawResponse = textContent.text;

      // Parse JSON response
      const jsonData = this.extractJSON(rawResponse);
      if (!jsonData) {
        // Save to debug file
        const debugDir = process.env.LOG_DIR || './logs';
        if (!fs.existsSync(debugDir)) {
          fs.mkdirSync(debugDir, { recursive: true });
        }
        const debugPath = path.join(
          debugDir,
          `failed-extraction-${metadata.productCode}-${Date.now()}.txt`
        );
        fs.writeFileSync(debugPath, rawResponse, 'utf-8');
        logger.error(`Full AI response saved to: ${debugPath}`);

        return {
          success: false,
          error: 'Failed to extract JSON from response (see logs for details)',
          rawResponse,
          processingTimeMs: Date.now() - startTime,
          retryCount,
        };
      }

      // Validate extracted data
      const validationResult = validateProductExtraction(jsonData);
      if (!validationResult.success) {
        // Try to salvage what we can
        const partialData = safeParseProductExtraction(jsonData);
        if (partialData) {
          logger.warn(
            `Partial extraction for ${metadata.productCode}: ${validationResult.error}`
          );
          const normalizedData = normalizeProductData(partialData);

          // Parse validation warnings from the error string
          const validationWarnings = this.parseValidationWarnings(validationResult.error || '');
          if (validationWarnings.length > 0) {
            logger.warn(
              `Validation warnings for ${metadata.productCode}: ${validationWarnings.length} issues (${validationWarnings.filter(w => w.severity === 'high').length} high severity)`
            );
          }

          const processingTimeMs = Date.now() - startTime;
          logApiResponse(metadata.productCode, true, processingTimeMs);

          return {
            success: true,
            data: normalizedData,
            rawResponse,
            error: `Partial extraction: ${validationResult.error}`,
            processingTimeMs,
            retryCount,
            validationWarnings,
          };
        }

        return {
          success: false,
          error: validationResult.error,
          rawResponse,
          processingTimeMs: Date.now() - startTime,
          retryCount,
        };
      }

      // Normalize data
      const normalizedData = normalizeProductData(validationResult.data!);

      const processingTimeMs = Date.now() - startTime;
      logApiResponse(metadata.productCode, true, processingTimeMs);

      return {
        success: true,
        data: normalizedData,
        rawResponse,
        processingTimeMs,
        retryCount,
      };
    } catch (error) {
      const processingTimeMs = Date.now() - startTime;
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';

      logger.error(`Extraction failed for ${metadata.productCode}: ${errorMsg}`, error);
      logApiResponse(metadata.productCode, false, processingTimeMs);

      return {
        success: false,
        error: errorMsg,
        processingTimeMs,
        retryCount,
      };
    }
  }

  // Hybrid extraction: Text extraction for ingredients/directions, Vision for supplement facts
  async extractProductInfoHybrid(
    metadata: PDFFileMetadata,
    retryCount = 0
  ): Promise<ExtractionResult> {
    const startTime = Date.now();

    try {
      logApiRequest(metadata.productCode, metadata.filePath);

      // Step 1: Extract raw text from PDF
      logger.debug(`Extracting text from PDF: ${metadata.productCode}`);
      const textExtraction = await extractAllSections(
        metadata.filePath,
        metadata.productName
        // Note: productSlogan not available yet; will use Vision API result for description
      );

      if (!textExtraction.success) {
        logger.warn(`Text extraction failed for ${metadata.productCode}, falling back to full vision extraction`);
        return this.extractProductInfo(metadata, retryCount);
      }

      // Step 2: Extract supplement facts using vision API
      logger.debug(`Extracting supplement facts with vision for ${metadata.productCode}`);

      // Validate PDF
      const validation = await validatePDF(metadata.filePath);
      if (!validation.isValid) {
        return {
          success: false,
          error: `Invalid PDF: ${validation.error}`,
          processingTimeMs: Date.now() - startTime,
          retryCount,
        };
      }

      // Convert PDF to base64
      const conversionResult = await convertPDFToBase64(metadata.filePath);
      if (!conversionResult.success) {
        return {
          success: false,
          error: `PDF conversion failed: ${conversionResult.error}`,
          processingTimeMs: Date.now() - startTime,
          retryCount,
        };
      }

      // Wait for rate limiter
      await this.rateLimiter.acquire();

      // Build prompt for supplement facts only
      const supplementPrompt = buildSupplementFactsOnlyPrompt(metadata);

      // Call Claude Vision API for supplement facts
      const visionResponse = await this.client.messages.create({
        model: env.AI_MODEL,
        max_tokens: env.AI_MAX_TOKENS,
        temperature: env.AI_TEMPERATURE,
        system: supplementPrompt.system,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'document',
                source: {
                  type: 'base64',
                  media_type: 'application/pdf',
                  data: conversionResult.base64Data!,
                },
              },
              {
                type: 'text',
                text: supplementPrompt.user,
              },
            ] as any,
          },
        ],
      });

      const visionTextContent = visionResponse.content.find((block) => block.type === 'text');
      if (!visionTextContent || visionTextContent.type !== 'text') {
        return {
          success: false,
          error: 'No text content in vision API response',
          processingTimeMs: Date.now() - startTime,
          retryCount,
        };
      }

      const supplementFactsJson = this.extractSupplementFactsJSON(visionTextContent.text);
      if (!supplementFactsJson) {
        logger.error(`Failed to extract supplement facts JSON for ${metadata.productCode}`);
        return {
          success: false,
          error: 'Failed to parse supplement facts JSON',
          processingTimeMs: Date.now() - startTime,
          retryCount,
        };
      }

      // Step 3: Structure text fields with minimal AI assistance
      logger.debug(`Structuring text fields for ${metadata.productCode}`);

      const textStructuringPrompt = buildTextStructuringPrompt({
        ingredientsText: textExtraction.ingredients || null,
        directionsText: textExtraction.directions || null,
        cautionText: textExtraction.caution || null,
        productName: metadata.productName,
        productCode: metadata.productCode
      });

      // Use same model as main extraction for consistency
      await this.rateLimiter.acquire();

      const textResponse = await this.client.messages.create({
        model: env.AI_MODEL,
        max_tokens: env.AI_MAX_TOKENS,
        temperature: env.AI_TEMPERATURE,
        messages: [
          {
            role: 'user',
            content: textStructuringPrompt,
          },
        ],
      });

      const textContent = textResponse.content.find((block) => block.type === 'text');
      if (!textContent || textContent.type !== 'text') {
        return {
          success: false,
          error: 'No text content in structuring API response',
          processingTimeMs: Date.now() - startTime,
          retryCount,
        };
      }

      const structuredTextData = this.extractTextStructuringJSON(textContent.text);
      if (!structuredTextData) {
        logger.error(`Failed to structure text data for ${metadata.productCode}`);
        // Fall back to raw text if structuring fails
        logger.warn('Falling back to raw text extraction');
      }

      // Step 4: Extract full product fields (description, slogan, dietary, references) via Vision
      logger.debug(`Extracting full product fields with vision for ${metadata.productCode}`);

      const fullProductPrompt = buildFullProductPrompt(metadata);
      await this.rateLimiter.acquire();

      const fullProductResponse = await this.client.messages.create({
        model: env.AI_MODEL,
        max_tokens: env.AI_MAX_TOKENS,
        temperature: env.AI_TEMPERATURE,
        system: fullProductPrompt.system,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'document',
                source: {
                  type: 'base64',
                  media_type: 'application/pdf',
                  data: conversionResult.base64Data!,
                },
              },
              {
                type: 'text',
                text: fullProductPrompt.user,
              },
            ] as any,
          },
        ],
      });

      const fullProductTextContent = fullProductResponse.content.find((block) => block.type === 'text');
      let fullProductData: {
        productDescription?: string;
        productSlogan?: string | null;
        subbrand?: string | null;
        dietaryAttributes?: string[];
        references?: string | null;
      } | null = null;

      if (fullProductTextContent && fullProductTextContent.type === 'text') {
        fullProductData = this.extractFullProductJSON(fullProductTextContent.text);
        if (!fullProductData) {
          logger.warn(`Failed to extract full product JSON for ${metadata.productCode}, using text extraction fallback`);
        }
      }

      // Step 5: Combine all extracted data with priority (Vision > Text extraction > Fallback)
      const combinedData = {
        productName: metadata.productName,
        productDescription: fullProductData?.productDescription || textExtraction.description || metadata.productName,
        subbrand: fullProductData?.subbrand || metadata.subbrand || null,
        supplementFacts: supplementFactsJson,
        ingredients: (structuredTextData as any)?.ingredients || [],
        directions: (structuredTextData as any)?.directions || textExtraction.directions || '',
        caution: (structuredTextData as any)?.caution || textExtraction.caution || null,
        dietaryAttributes: fullProductData?.dietaryAttributes || textExtraction.dietaryAttributes || [],
        references: fullProductData?.references || textExtraction.references || null,
        productSlogan: fullProductData?.productSlogan || null
      };

      // Validate combined data
      const validationResult = validateProductExtraction(combinedData);
      if (!validationResult.success) {
        const partialData = safeParseProductExtraction(combinedData);
        if (partialData) {
          logger.warn(`Partial hybrid extraction for ${metadata.productCode}: ${validationResult.error}`);
          const normalizedData = normalizeProductData(partialData);

          // Parse validation warnings from the error string
          const validationWarnings = this.parseValidationWarnings(validationResult.error || '');
          if (validationWarnings.length > 0) {
            logger.warn(
              `Validation warnings for ${metadata.productCode}: ${validationWarnings.length} issues (${validationWarnings.filter(w => w.severity === 'high').length} high severity)`
            );
          }

          const processingTimeMs = Date.now() - startTime;
          logApiResponse(metadata.productCode, true, processingTimeMs);

          return {
            success: true,
            data: normalizedData,
            rawResponse: JSON.stringify({ vision: visionTextContent.text, text: textContent.text }),
            error: `Partial extraction: ${validationResult.error}`,
            processingTimeMs,
            retryCount,
            validationWarnings,
          };
        }

        return {
          success: false,
          error: validationResult.error,
          rawResponse: JSON.stringify({ vision: visionTextContent.text, text: textContent.text }),
          processingTimeMs: Date.now() - startTime,
          retryCount,
        };
      }

      // Normalize data
      const normalizedData = normalizeProductData(validationResult.data!);
      const processingTimeMs = Date.now() - startTime;
      logApiResponse(metadata.productCode, true, processingTimeMs);

      return {
        success: true,
        data: normalizedData,
        rawResponse: JSON.stringify({ vision: visionTextContent.text, text: textContent.text }),
        processingTimeMs,
        retryCount,
      };
    } catch (error) {
      const processingTimeMs = Date.now() - startTime;
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';

      logger.error(`Hybrid extraction failed for ${metadata.productCode}: ${errorMsg}`, error);
      logApiResponse(metadata.productCode, false, processingTimeMs);

      return {
        success: false,
        error: errorMsg,
        processingTimeMs,
        retryCount,
      };
    }
  }

  private extractJSON(text: string): unknown {
    try {
      const result = extractAllStrategies(text);

      if (result.success) {
        logger.debug(`JSON extracted using strategy: ${result.strategy}`);
        logger.debug(`Extracted JSON preview: ${JSON.stringify(result.data).substring(0, 200)}...`);

        // Log if repair or json5 strategies were needed
        if (result.strategy === 'repair' || result.strategy === 'json5') {
          logger.warn(`Non-standard strategy used: ${result.strategy} - AI response may need prompt improvements`);
        }

        return result.data;
      }

      // Enhanced error logging with pattern detection
      logger.error('All JSON extraction strategies failed');
      logger.error(`Response length: ${text.length} characters`);
      logger.error(`Response preview (first 500 chars): ${text.substring(0, 500)}`);
      logger.error(`Response preview (last 500 chars): ${text.substring(Math.max(0, text.length - 500))}`);

      // Detect suspicious patterns
      const suspiciousPatterns = this.detectSuspiciousPatterns(text);
      if (suspiciousPatterns.length > 0) {
        logger.error('Suspicious patterns detected:');
        suspiciousPatterns.forEach(pattern => {
          logger.error(`  - ${pattern.type} at position ${pattern.position}: ${pattern.context}`);
        });
      }

      return null;
    } catch (error) {
      logger.error('Unexpected error in JSON extraction', error);
      logger.error(`Response that caused error: ${text.substring(0, 1000)}`);
      return null;
    }
  }

  private extractSupplementFactsJSON(text: string): unknown {
    try {
      // Use a modified version of extractAllStrategies that validates supplement facts instead of full products
      const result = this.extractJSONWithValidator(text, isLikelySupplementFacts);

      if (result.success) {
        logger.debug(`Supplement facts JSON extracted using strategy: ${result.strategy}`);
        logger.debug(`Extracted supplement facts preview: ${JSON.stringify(result.data).substring(0, 200)}...`);

        // Log if repair or json5 strategies were needed
        if (result.strategy === 'repair' || result.strategy === 'json5') {
          logger.warn(`Non-standard strategy used for supplement facts: ${result.strategy}`);
        }

        return result.data;
      }

      // Enhanced error logging
      logger.error('All supplement facts extraction strategies failed');
      logger.error(`Response length: ${text.length} characters`);
      logger.error(`Response preview (first 500 chars): ${text.substring(0, 500)}`);
      logger.error(`Response preview (last 500 chars): ${text.substring(Math.max(0, text.length - 500))}`);

      return null;
    } catch (error) {
      logger.error('Unexpected error in supplement facts extraction', error);
      logger.error(`Response that caused error: ${text.substring(0, 1000)}`);
      return null;
    }
  }

  private extractTextStructuringJSON(text: string): unknown {
    try {
      // Use text structuring validator (ingredients/directions/caution)
      const result = this.extractJSONWithValidator(text, isLikelyTextStructuring);

      if (result.success) {
        logger.debug(`Text structuring JSON extracted using strategy: ${result.strategy}`);
        return result.data;
      }

      // Enhanced error logging
      logger.error('All JSON extraction strategies failed');
      logger.error(`Response length: ${text.length} characters`);
      logger.error(`Response preview (first 500 chars): ${text.substring(0, 500)}`);
      logger.error(`Response preview (last 500 chars): ${text.substring(Math.max(0, text.length - 500))}`);

      return null;
    } catch (error) {
      logger.error('Unexpected error in text structuring extraction', error);
      return null;
    }
  }

  private extractFullProductJSON(text: string): {
    productDescription?: string;
    productSlogan?: string | null;
    subbrand?: string | null;
    dietaryAttributes?: string[];
    references?: string | null;
  } | null {
    try {
      // Use a validator that checks for full product fields
      const result = this.extractJSONWithValidator(text, isLikelyFullProduct);

      if (result.success) {
        logger.debug(`Full product JSON extracted using strategy: ${result.strategy}`);
        return result.data as {
          productDescription?: string;
          productSlogan?: string | null;
          subbrand?: string | null;
          dietaryAttributes?: string[];
          references?: string | null;
        };
      }

      // Fallback: try to parse any valid JSON even if it doesn't match expected structure
      const fallbackResult = this.extractJSONWithValidator(text, (data) => typeof data === 'object' && data !== null);
      if (fallbackResult.success) {
        logger.warn('Full product extraction used fallback parsing');
        return fallbackResult.data as {
          productDescription?: string;
          productSlogan?: string | null;
          subbrand?: string | null;
          dietaryAttributes?: string[];
          references?: string | null;
        };
      }

      // Enhanced error logging
      logger.error('All full product extraction strategies failed');
      logger.error(`Response length: ${text.length} characters`);
      logger.error(`Response preview (first 500 chars): ${text.substring(0, 500)}`);

      return null;
    } catch (error) {
      logger.error('Unexpected error in full product extraction', error);
      return null;
    }
  }

  private extractJSONWithValidator(text: string, validator: (data: unknown) => boolean): { success: boolean; data?: unknown; strategy?: string; error?: string } {
    // Try each strategy manually with custom validator
    const strategies = [
      { name: 'directParse', fn: () => this.tryDirectParseWithValidator(text, validator) },
      { name: 'balancedBraces', fn: () => this.tryBalancedBracesWithValidator(text, validator) },
      { name: 'codeBlock', fn: () => this.tryCodeBlockWithValidator(text, validator) },
      { name: 'cleanup', fn: () => this.tryCleanupWithValidator(text, validator) },
      { name: 'repair', fn: () => this.tryRepairWithValidator(text, validator) },
      { name: 'json5', fn: () => this.tryJSON5WithValidator(text, validator) },
    ];

    for (const strategy of strategies) {
      const result = strategy.fn();
      if (result.success) {
        return { ...result, strategy: strategy.name };
      }
    }

    return { success: false, error: 'All extraction strategies failed' };
  }

  private tryDirectParseWithValidator(text: string, validator: (data: unknown) => boolean): { success: boolean; data?: unknown } {
    try {
      const trimmed = text.trim();
      const data = JSON.parse(trimmed);
      if (validator(data)) {
        return { success: true, data };
      }
      return { success: false };
    } catch {
      return { success: false };
    }
  }

  private tryBalancedBracesWithValidator(text: string, validator: (data: unknown) => boolean): { success: boolean; data?: unknown } {
    try {
      const firstBrace = text.indexOf('{');
      if (firstBrace === -1) return { success: false };

      const endIndex = this.findBalancedJSON(text, firstBrace);
      if (endIndex === -1) return { success: false };

      const jsonString = text.substring(firstBrace, endIndex);
      const data = JSON.parse(jsonString);
      if (validator(data)) {
        return { success: true, data };
      }
      return { success: false };
    } catch {
      return { success: false };
    }
  }

  private tryCodeBlockWithValidator(text: string, validator: (data: unknown) => boolean): { success: boolean; data?: unknown } {
    try {
      const jsonBlockMatch = text.match(/```json\s*([\s\S]*?)```/);
      if (jsonBlockMatch) {
        const data = JSON.parse(jsonBlockMatch[1].trim());
        if (validator(data)) {
          return { success: true, data };
        }
      }

      const genericBlockMatch = text.match(/```\s*([\s\S]*?)```/);
      if (genericBlockMatch) {
        const content = genericBlockMatch[1].trim();
        if (content.startsWith('{')) {
          const data = JSON.parse(content);
          if (validator(data)) {
            return { success: true, data };
          }
        }
      }

      return { success: false };
    } catch {
      return { success: false };
    }
  }

  private tryCleanupWithValidator(text: string, validator: (data: unknown) => boolean): { success: boolean; data?: unknown } {
    try {
      let cleaned = text;
      const patternsToRemove = [
        /here\s+is\s+the\s+extracted\s+data[:\s]*/gi,
        /i\s+hope\s+this\s+helps[.\s]*/gi,
        /let\s+me\s+know\s+if\s+you\s+need[.\s\S]*$/gi,
        /here'?s?\s+the\s+json[:\s]*/gi,
        /the\s+extracted\s+information[:\s]*/gi,
        /based\s+on\s+the\s+document[:\s]*/gi,
      ];

      for (const pattern of patternsToRemove) {
        cleaned = cleaned.replace(pattern, '');
      }
      cleaned = cleaned.trim();

      const directResult = this.tryDirectParseWithValidator(cleaned, validator);
      if (directResult.success) return directResult;

      return this.tryBalancedBracesWithValidator(cleaned, validator);
    } catch {
      return { success: false };
    }
  }

  private tryRepairWithValidator(text: string, validator: (data: unknown) => boolean): { success: boolean; data?: unknown } {
    // Import repair function from json-extractor
    const { repairCommonJSONErrors } = require('./json-extractor.js');
    const result = repairCommonJSONErrors(text);
    if (result.success && validator(result.data)) {
      return { success: true, data: result.data };
    }
    return { success: false };
  }

  private tryJSON5WithValidator(text: string, validator: (data: unknown) => boolean): { success: boolean; data?: unknown } {
    // Import JSON5 parse function from json-extractor
    const { tryJSON5Parse } = require('./json-extractor.js');
    const result = tryJSON5Parse(text);
    if (result.success && validator(result.data)) {
      return { success: true, data: result.data };
    }
    return { success: false };
  }

  private findBalancedJSON(text: string, startIndex: number): number {
    let braceCount = 0;
    let inString = false;
    let escaped = false;

    for (let i = startIndex; i < text.length; i++) {
      const char = text[i];

      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }

      if (char === '"') {
        inString = !inString;
        continue;
      }

      if (!inString) {
        if (char === '{') {
          braceCount++;
        }
        if (char === '}') {
          braceCount--;
          if (braceCount === 0) {
            return i + 1;
          }
        }
      }
    }

    return -1;
  }

  private detectSuspiciousPatterns(text: string): Array<{type: string, position: number, context: string}> {
    const patterns: Array<{type: string, position: number, context: string}> = [];

    // Look for unescaped newlines in strings
    let inString = false;
    let escaped = false;
    for (let i = 0; i < text.length; i++) {
      const char = text[i];

      if (escaped) {
        escaped = false;
        continue;
      }

      if (char === '\\') {
        escaped = true;
        continue;
      }

      if (char === '"') {
        inString = !inString;
        continue;
      }

      if (inString && (char === '\n' || char === '\r')) {
        const context = text.substring(Math.max(0, i - 30), Math.min(text.length, i + 30))
          .replace(/\n/g, '\\n').replace(/\r/g, '\\r');
        patterns.push({
          type: 'Unescaped newline in string',
          position: i,
          context: context
        });
      }
    }

    // Look for consecutive quotes (possible unterminated string)
    const consecutiveQuotesRegex = /""/g;
    let match;
    while ((match = consecutiveQuotesRegex.exec(text)) !== null) {
      const context = text.substring(Math.max(0, match.index - 30), Math.min(text.length, match.index + 30));
      patterns.push({
        type: 'Consecutive quotes',
        position: match.index,
        context: context
      });
    }

    // Look for very long strings (>2000 chars) which might cause issues
    const stringLengthRegex = /"([^"\\]|\\.){2000,}"/g;
    while ((match = stringLengthRegex.exec(text)) !== null) {
      patterns.push({
        type: 'Very long string (>2000 chars)',
        position: match.index,
        context: `String of length ${match[0].length}`
      });
    }

    return patterns;
  }

  /**
   * Parse validation error strings into structured warnings
   * Example input: "supplementFacts.nutrients.9.amount: Amount must include number and unit"
   */
  private parseValidationWarnings(errorString: string): ValidationWarning[] {
    const warnings: ValidationWarning[] = [];

    // Split by semicolons or newlines to handle multiple errors
    const errorParts = errorString.split(/[;\n]/).map(s => s.trim()).filter(Boolean);

    for (const part of errorParts) {
      // Try to extract field path and message
      // Pattern: "fieldPath: message" or just "message"
      const colonIndex = part.indexOf(':');
      let fieldPath: string;
      let message: string;

      if (colonIndex > 0 && colonIndex < 100) {
        // Check if the part before colon looks like a field path (contains dots or brackets)
        const potentialPath = part.substring(0, colonIndex).trim();
        if (potentialPath.includes('.') || potentialPath.includes('[')) {
          fieldPath = potentialPath;
          message = part.substring(colonIndex + 1).trim();
        } else {
          // Might be "Partial extraction: message"
          fieldPath = 'unknown';
          message = part;
        }
      } else {
        fieldPath = 'unknown';
        message = part;
      }

      // Skip generic messages that aren't actual field validation errors
      if (message.toLowerCase().startsWith('partial extraction')) {
        continue;
      }

      const severity = this.determineValidationSeverity(fieldPath, message);

      warnings.push({
        fieldPath,
        message,
        severity,
      });
    }

    return warnings;
  }

  /**
   * Determine severity based on field path and message content
   */
  private determineValidationSeverity(fieldPath: string, message: string): 'low' | 'medium' | 'high' {
    const lowerPath = fieldPath.toLowerCase();
    const lowerMessage = message.toLowerCase();

    // HIGH severity: nutrient amounts are critical supplement data
    if (lowerPath.includes('nutrients') && lowerPath.includes('amount')) {
      return 'high';
    }
    if (lowerMessage.includes('amount must include') || lowerMessage.includes('invalid amount')) {
      return 'high';
    }

    // MEDIUM severity: daily values and serving info
    if (lowerPath.includes('dailyvalue') || lowerPath.includes('daily_value')) {
      return 'medium';
    }
    if (lowerPath.includes('servings') || lowerPath.includes('serving')) {
      return 'medium';
    }

    // LOW severity: everything else (metadata, formatting)
    return 'low';
  }
}

// Rate limiter to respect API limits
class RateLimiter {
  private requestTimes: number[] = [];
  private maxRequestsPerMinute: number;

  constructor(maxRequestsPerMinute: number) {
    this.maxRequestsPerMinute = maxRequestsPerMinute;
  }

  async acquire(): Promise<void> {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;

    // Remove old requests
    this.requestTimes = this.requestTimes.filter((time) => time > oneMinuteAgo);

    // Check if we need to wait
    if (this.requestTimes.length >= this.maxRequestsPerMinute) {
      const oldestRequest = this.requestTimes[0];
      const waitTime = 60000 - (now - oldestRequest) + 100; // Add 100ms buffer

      if (waitTime > 0) {
        logger.debug(`Rate limit reached, waiting ${waitTime}ms`);
        await new Promise((resolve) => setTimeout(resolve, waitTime));
        return this.acquire(); // Recursive call after waiting
      }
    }

    this.requestTimes.push(now);
  }
}
