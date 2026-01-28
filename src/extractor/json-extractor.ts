/**
 * Multi-strategy JSON extraction utility for AI responses
 *
 * Implements a cascade of extraction strategies to handle various AI response formats:
 * 1. Direct Parse - Parse entire response (works when AI follows instructions perfectly)
 * 2. Balanced Brace Matching - Extract JSON using proper brace balance counting
 * 3. Code Block Detection - Extract from markdown code blocks (```json...```)
 * 4. Cleanup & Retry - Remove common AI explanation patterns and retry
 * 5. Repair Common Errors - Fix unescaped newlines, unterminated strings, and long strings
 * 6. JSON5 Lenient Parse - Last resort using more lenient JSON5 parser
 */

import { isLikelyProductExtraction } from '../parser/json-validator.js';
import JSON5 from 'json5';

export interface ExtractionResult {
  success: boolean;
  data?: unknown;
  strategy?: string;
  error?: string;
}

/**
 * Main entry point that cascades through all extraction strategies
 */
export function extractAllStrategies(text: string): ExtractionResult {
  // Strategy 1: Direct Parse
  const directResult = tryDirectParse(text);
  if (directResult.success && isLikelyProductExtraction(directResult.data)) {
    return { ...directResult, strategy: 'directParse' };
  }

  // Strategy 2: Balanced Brace Matching
  const balancedResult = extractBalancedBraces(text);
  if (balancedResult.success && isLikelyProductExtraction(balancedResult.data)) {
    return { ...balancedResult, strategy: 'balancedBraces' };
  }

  // Strategy 3: Code Block Detection
  const codeBlockResult = extractFromCodeBlock(text);
  if (codeBlockResult.success && isLikelyProductExtraction(codeBlockResult.data)) {
    return { ...codeBlockResult, strategy: 'codeBlock' };
  }

  // Strategy 4: Cleanup & Retry
  const cleanupResult = extractWithCleanup(text);
  if (cleanupResult.success && isLikelyProductExtraction(cleanupResult.data)) {
    return { ...cleanupResult, strategy: 'cleanup' };
  }

  // Strategy 5: Repair Common JSON Errors
  const repairResult = repairCommonJSONErrors(text);
  if (repairResult.success && isLikelyProductExtraction(repairResult.data)) {
    return { ...repairResult, strategy: 'repair' };
  }

  // Strategy 6: JSON5 Lenient Parse (last resort)
  const json5Result = tryJSON5Parse(text);
  if (json5Result.success && isLikelyProductExtraction(json5Result.data)) {
    return { ...json5Result, strategy: 'json5' };
  }

  return {
    success: false,
    error: 'All extraction strategies failed',
  };
}

/**
 * Strategy 1: Try to parse the entire response as JSON
 */
function tryDirectParse(text: string): ExtractionResult {
  try {
    const trimmed = text.trim();
    const data = JSON.parse(trimmed);
    return { success: true, data };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

/**
 * Strategy 2: Extract JSON using balanced brace counting
 * Finds the first complete JSON object by counting braces
 */
export function extractBalancedBraces(text: string): ExtractionResult {
  try {
    const firstBrace = text.indexOf('{');
    if (firstBrace === -1) {
      return { success: false, error: 'No opening brace found' };
    }

    const endIndex = findBalancedJSON(text, firstBrace);
    if (endIndex === -1) {
      return { success: false, error: 'No balanced JSON structure found' };
    }

    const jsonString = text.substring(firstBrace, endIndex);
    const data = JSON.parse(jsonString);
    return { success: true, data };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

/**
 * Strategy 3: Extract from markdown code blocks
 * Handles ```json...``` or ```{...}``` formats
 * Also handles unclosed/truncated code blocks
 */
export function extractFromCodeBlock(text: string): ExtractionResult {
  try {
    // Try to find ```json ... ``` block (closed)
    const jsonBlockMatch = text.match(/```json\s*([\s\S]*?)```/);
    if (jsonBlockMatch) {
      const data = JSON.parse(jsonBlockMatch[1].trim());
      return { success: true, data };
    }

    // Try to find ``` ... ``` block that starts with { (closed)
    const genericBlockMatch = text.match(/```\s*([\s\S]*?)```/);
    if (genericBlockMatch) {
      const content = genericBlockMatch[1].trim();
      if (content.startsWith('{')) {
        const data = JSON.parse(content);
        return { success: true, data };
      }
    }

    // Handle unclosed code blocks (truncated responses)
    const unclosedjsonMatch = text.match(/```json\s*([\s\S]*?)$/);
    if (unclosedjsonMatch) {
      const content = unclosedjsonMatch[1].trim();
      if (content.startsWith('{')) {
        const data = JSON.parse(content);
        return { success: true, data };
      }
    }

    // Handle unclosed generic code blocks
    const unclosedGenericMatch = text.match(/```\s*([\s\S]*?)$/);
    if (unclosedGenericMatch) {
      const content = unclosedGenericMatch[1].trim();
      if (content.startsWith('{')) {
        const data = JSON.parse(content);
        return { success: true, data };
      }
    }

    return { success: false, error: 'No code block found or invalid JSON in block' };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

/**
 * Strategy 4: Remove common AI explanation patterns and retry
 */
export function extractWithCleanup(text: string): ExtractionResult {
  try {
    let cleaned = text;

    // Common patterns to remove (case insensitive)
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

    // Try direct parse on cleaned text
    const directResult = tryDirectParse(cleaned);
    if (directResult.success) {
      return directResult;
    }

    // Try balanced braces on cleaned text
    return extractBalancedBraces(cleaned);
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

/**
 * Strategy 5: Repair common JSON errors and retry parsing
 * This strategy attempts to fix common malformed JSON issues:
 * - Unescaped newlines in strings
 * - Unterminated strings
 * - Extremely long strings
 */
export function repairCommonJSONErrors(text: string): ExtractionResult {
  try {
    let repaired = text;

    // First, extract the JSON object using balanced braces
    const firstBrace = repaired.indexOf('{');
    if (firstBrace === -1) {
      return { success: false, error: 'No JSON object found' };
    }

    const endIndex = findBalancedJSON(repaired, firstBrace);
    if (endIndex === -1) {
      return { success: false, error: 'No balanced JSON found' };
    }

    repaired = repaired.substring(firstBrace, endIndex);

    // Apply repair strategies
    repaired = repairUnescapedNewlines(repaired);
    repaired = truncateLongStrings(repaired);
    repaired = repairUnterminatedStrings(repaired);

    // Try to parse the repaired JSON
    const data = JSON.parse(repaired);
    return { success: true, data };
  } catch (error) {
    return { success: false, error: `Repair failed: ${String(error)}` };
  }
}

/**
 * Helper: Repair unescaped newlines in string values
 * Replaces actual newline characters with \n escape sequence
 */
function repairUnescapedNewlines(text: string): string {
  let result = '';
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    // Handle escape sequences
    if (escaped) {
      result += char;
      escaped = false;
      continue;
    }

    if (char === '\\') {
      result += char;
      escaped = true;
      continue;
    }

    // Track string boundaries
    if (char === '"') {
      inString = !inString;
      result += char;
      continue;
    }

    // Replace actual newlines with escaped newlines when inside strings
    if (inString && (char === '\n' || char === '\r')) {
      // Skip \r in \r\n sequences
      if (char === '\r' && i + 1 < text.length && text[i + 1] === '\n') {
        continue;
      }
      result += '\\n';
      continue;
    }

    result += char;
  }

  return result;
}

/**
 * Helper: Truncate extremely long string values (>2000 characters)
 * This prevents memory issues and focuses on reasonable data sizes
 */
function truncateLongStrings(text: string): string {
  const maxStringLength = 2000;
  let result = '';
  let inString = false;
  let escaped = false;
  let currentStringContent = '';

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    // Handle escape sequences
    if (escaped) {
      if (inString) {
        currentStringContent += '\\' + char;
      } else {
        result += '\\' + char;
      }
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }

    // Track string boundaries
    if (char === '"') {
      if (!inString) {
        // Starting a string
        inString = true;
        currentStringContent = '';
        result += char;
      } else {
        // Ending a string
        if (currentStringContent.length > maxStringLength) {
          // Truncate the string
          result += currentStringContent.substring(0, maxStringLength - 3) + '...';
        } else {
          result += currentStringContent;
        }
        result += char;
        inString = false;
        currentStringContent = '';
      }
      continue;
    }

    // Accumulate string content or add to result
    if (inString) {
      currentStringContent += char;
    } else {
      result += char;
    }
  }

  // Handle unterminated string (add closing quote)
  if (inString) {
    if (currentStringContent.length > maxStringLength) {
      result += currentStringContent.substring(0, maxStringLength - 3) + '..."';
    } else {
      result += currentStringContent + '"';
    }
  }

  return result;
}

/**
 * Helper: Attempt to close unterminated strings
 * Looks for strings that are missing closing quotes and adds them
 */
function repairUnterminatedStrings(text: string): string {
  let result = '';
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    // Handle escape sequences
    if (escaped) {
      result += char;
      escaped = false;
      continue;
    }

    if (char === '\\') {
      result += char;
      escaped = true;
      continue;
    }

    // Track string boundaries
    if (char === '"') {
      inString = !inString;
      result += char;
      continue;
    }

    // If we encounter a comma or brace while in a string, the string is likely unterminated
    if (inString && (char === ',' || char === '}' || char === ']')) {
      // Close the string before the comma/brace
      result += '"';
      inString = false;
    }

    result += char;
  }

  // If still in string at end, close it
  if (inString) {
    result += '"';
  }

  return result;
}

/**
 * Strategy 6: Try parsing with JSON5 (more lenient parser)
 * JSON5 allows:
 * - Trailing commas
 * - Single quotes for strings
 * - Unquoted keys
 * - Comments
 * This is a last resort for edge cases
 */
export function tryJSON5Parse(text: string): ExtractionResult {
  try {
    // First try to extract JSON object
    const firstBrace = text.indexOf('{');
    if (firstBrace === -1) {
      return { success: false, error: 'No opening brace found' };
    }

    const endIndex = findBalancedJSON(text, firstBrace);
    if (endIndex === -1) {
      // If balanced extraction fails, try parsing the whole text
      const data = JSON5.parse(text);
      return { success: true, data };
    }

    const jsonString = text.substring(firstBrace, endIndex);
    const data = JSON5.parse(jsonString);
    return { success: true, data };
  } catch (error) {
    return { success: false, error: `JSON5 parse failed: ${String(error)}` };
  }
}

/**
 * Helper function to find the end of a balanced JSON structure
 * Properly handles strings, escape sequences, and nested objects
 *
 * @param text The text to search
 * @param startIndex The index of the opening brace
 * @returns The index after the closing brace, or -1 if not found
 */
export function findBalancedJSON(text: string, startIndex: number): number {
  let braceCount = 0;
  let inString = false;
  let escaped = false;

  for (let i = startIndex; i < text.length; i++) {
    const char = text[i];

    // Handle escape sequences in strings
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }

    // Track string boundaries (don't count braces inside strings)
    if (char === '"') {
      inString = !inString;
      continue;
    }

    // Count braces only outside strings
    if (!inString) {
      if (char === '{') {
        braceCount++;
      }
      if (char === '}') {
        braceCount--;
        if (braceCount === 0) {
          return i + 1; // Found complete JSON
        }
      }
    }
  }

  return -1; // No balanced JSON found
}
