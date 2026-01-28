import { z } from 'zod';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// Environment variable schema
const envSchema = z.object({
  ANTHROPIC_API_KEY: z.string().min(1, 'ANTHROPIC_API_KEY is required'),
  DATABASE_PATH: z.string().default('./products.db'),
  PDF_ROOT_PATH: z.string().default('./products'),
  CONCURRENT_PROCESSES: z.coerce.number().int().positive().default(5),
  MAX_RETRIES: z.coerce.number().int().positive().default(3),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(50),
  AI_MODEL: z.string().default('claude-sonnet-4-5-20250929'),
  AI_MAX_TOKENS: z.coerce.number().int().positive().default(4096),
  AI_TEMPERATURE: z.coerce.number().min(0).max(1).default(0),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  LOG_DIR: z.string().default('./logs'),

  // Grok API Configuration
  GROK_API_KEY: z.string().default(''),
  ENABLE_GROK_VERIFICATION: z.coerce.boolean().default(false),
  GROK_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(30),
  GROK_MODEL: z.string().default('grok-2-vision-1212'),

  // Verification Settings
  VERIFICATION_SIMILARITY_THRESHOLD: z.coerce.number().int().default(85),
  AUTO_REVIEW_THRESHOLD: z.coerce.number().int().default(70),

  // Extraction Settings
  ENABLE_HYBRID_EXTRACTION: z.coerce.boolean().default(true),
  USE_TEXT_EXTRACTION_FOR_INGREDIENTS: z.coerce.boolean().default(true),
  ENABLE_STRICT_NORMALIZATION: z.coerce.boolean().default(false),
});

// Parse and validate environment variables
function validateEnv() {
  try {
    const parsed = envSchema.parse(process.env);

    // Validate Grok API key if verification is enabled
    if (parsed.ENABLE_GROK_VERIFICATION && !parsed.GROK_API_KEY) {
      throw new Error('GROK_API_KEY is required when ENABLE_GROK_VERIFICATION is true');
    }

    return parsed;
  } catch (error) {
    if (error instanceof z.ZodError) {
      const missingVars = error.errors.map(err => `${err.path.join('.')}: ${err.message}`);
      throw new Error(`Environment validation failed:\n${missingVars.join('\n')}`);
    }
    throw error;
  }
}

export const env = validateEnv();

export type Env = z.infer<typeof envSchema>;
