import OpenAI from 'openai';
import { env } from '../config/env.js';
import { PDFFileMetadata } from '../scanner/file-parser.js';
import { convertPDFToImages } from './pdf-converter.js';
import { buildSupplementFactsOnlyPrompt } from './prompt-builder.js';
import { SupplementFactsData } from '../parser/json-validator.js';
import logger from '../utils/logger.js';
import { extractBalancedBraces, extractFromCodeBlock } from './json-extractor.js';
import JSON5 from 'json5';

export interface GrokVerificationResult {
  success: boolean;
  supplementFacts?: SupplementFactsData;
  rawResponse?: string;
  error?: string;
  extractionTimeMs?: number;
}

export class GrokExtractor {
  private client: OpenAI;
  private rateLimiter: RateLimiter;

  constructor() {
    // Grok uses OpenAI-compatible API
    this.client = new OpenAI({
      apiKey: env.GROK_API_KEY,
      baseURL: 'https://api.x.ai/v1'
    });
    this.rateLimiter = new RateLimiter(env.GROK_RATE_LIMIT_PER_MINUTE);
  }

  async verifySupplementFacts(
    metadata: PDFFileMetadata
  ): Promise<GrokVerificationResult> {
    const startTime = Date.now();

    try {
      // Convert PDF to PNG images (Grok doesn't support PDF directly)
      const conversionResult = await convertPDFToImages(metadata.filePath);
      if (!conversionResult.success || !conversionResult.images) {
        return {
          success: false,
          error: `PDF to image conversion failed: ${conversionResult.error}`,
          extractionTimeMs: Date.now() - startTime
        };
      }

      // Rate limit
      await this.rateLimiter.acquire();

      // Build focused prompt for ONLY supplement facts
      const prompt = buildSupplementFactsOnlyPrompt(metadata);

      logger.debug(`Calling Grok API for product ${metadata.productCode} with ${conversionResult.images.length} page images`);

      // Build content array with images first, then text prompt
      const userContent: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
        // Add each page as a separate image
        ...conversionResult.images.map((imgBase64) => ({
          type: 'image_url' as const,
          image_url: {
            url: `data:image/png;base64,${imgBase64}`
          }
        })),
        // Add the text prompt at the end
        {
          type: 'text' as const,
          text: prompt.user
        }
      ];

      // Call Grok Vision API
      const response = await this.client.chat.completions.create({
        model: env.GROK_MODEL || 'grok-2-vision-1212',
        messages: [
          {
            role: 'system',
            content: prompt.system
          },
          {
            role: 'user',
            content: userContent
          }
        ],
        temperature: 0,
        max_tokens: 2000
      });

      const rawResponse = response.choices[0].message.content || '';

      if (!rawResponse) {
        return {
          success: false,
          error: 'Empty response from Grok API',
          extractionTimeMs: Date.now() - startTime
        };
      }

      // Parse supplement facts from response
      const supplementFacts = this.parseSupplementFacts(rawResponse);

      logger.debug(`Grok extraction completed for ${metadata.productCode} in ${Date.now() - startTime}ms`);

      return {
        success: true,
        supplementFacts,
        rawResponse,
        extractionTimeMs: Date.now() - startTime
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Grok verification failed for ${metadata.productCode}: ${errorMsg}`, error);

      return {
        success: false,
        error: errorMsg,
        extractionTimeMs: Date.now() - startTime
      };
    }
  }

  private parseSupplementFacts(rawResponse: string): SupplementFactsData {
    // Try multiple extraction strategies for supplement facts JSON
    let data: any = null;

    // Strategy 1: Try extracting from code block
    const codeBlockResult = extractFromCodeBlock(rawResponse);
    if (codeBlockResult.success) {
      data = codeBlockResult.data;
    }

    // Strategy 2: Try balanced braces extraction
    if (!data) {
      const bracesResult = extractBalancedBraces(rawResponse);
      if (bracesResult.success) {
        data = bracesResult.data;
      }
    }

    // Strategy 3: Try direct JSON parse
    if (!data) {
      try {
        data = JSON.parse(rawResponse.trim());
      } catch {
        // Continue to next strategy
      }
    }

    // Strategy 4: Try JSON5 lenient parse
    if (!data) {
      try {
        const firstBrace = rawResponse.indexOf('{');
        const lastBrace = rawResponse.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace > firstBrace) {
          data = JSON5.parse(rawResponse.substring(firstBrace, lastBrace + 1));
        }
      } catch {
        // All strategies failed
      }
    }

    if (!data) {
      logger.debug(`Grok raw response: ${rawResponse.substring(0, 500)}...`);
      throw new Error('Failed to parse Grok response as JSON');
    }

    // Validate the structure has required supplement facts fields
    if (!data.servings && !data.servingsPerContainer && !data.nutrients) {
      logger.debug(`Grok parsed data missing fields: ${JSON.stringify(data).substring(0, 500)}`);
      throw new Error('Missing required supplement facts fields (servings, servingsPerContainer, or nutrients)');
    }

    return data as SupplementFactsData;
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
        logger.debug(`Grok rate limit reached, waiting ${waitTime}ms`);
        await new Promise((resolve) => setTimeout(resolve, waitTime));
        return this.acquire(); // Recursive call after waiting
      }
    }

    this.requestTimes.push(now);
  }
}
