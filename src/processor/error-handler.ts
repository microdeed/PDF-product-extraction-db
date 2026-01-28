import logger from '../utils/logger.js';
import { env } from '../config/env.js';

export interface RetryConfig {
  maxRetries: number;
  baseDelay: number; // ms
  maxDelay: number; // ms
  backoffMultiplier: number;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: env.MAX_RETRIES,
  baseDelay: 1000,
  maxDelay: 10000,
  backoffMultiplier: 2,
};

export class ErrorHandler {
  private config: RetryConfig;

  constructor(config: RetryConfig = DEFAULT_RETRY_CONFIG) {
    this.config = config;
  }

  // Execute function with retry logic
  async withRetry<T>(
    fn: () => Promise<T>,
    context: string,
    currentAttempt = 0
  ): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';

      if (currentAttempt >= this.config.maxRetries) {
        logger.error(
          `${context} failed after ${this.config.maxRetries} retries: ${errorMsg}`
        );
        throw error;
      }

      const delay = this.calculateDelay(currentAttempt);
      logger.warn(
        `${context} failed (attempt ${currentAttempt + 1}/${this.config.maxRetries}), retrying in ${delay}ms: ${errorMsg}`
      );

      await this.sleep(delay);
      return this.withRetry(fn, context, currentAttempt + 1);
    }
  }

  // Calculate exponential backoff delay
  private calculateDelay(attemptNumber: number): number {
    const delay = Math.min(
      this.config.baseDelay * Math.pow(this.config.backoffMultiplier, attemptNumber),
      this.config.maxDelay
    );
    // Add jitter to prevent thundering herd
    return delay + Math.random() * 1000;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Classify error types
  static classifyError(error: unknown): ErrorType {
    const errorMsg =
      error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

    if (errorMsg.includes('rate limit') || errorMsg.includes('429')) {
      return 'RATE_LIMIT';
    }

    if (errorMsg.includes('timeout') || errorMsg.includes('timed out')) {
      return 'TIMEOUT';
    }

    if (
      errorMsg.includes('network') ||
      errorMsg.includes('econnrefused') ||
      errorMsg.includes('enotfound')
    ) {
      return 'NETWORK';
    }

    if (
      errorMsg.includes('invalid pdf') ||
      errorMsg.includes('corrupt') ||
      errorMsg.includes('malformed')
    ) {
      return 'INVALID_FILE';
    }

    if (errorMsg.includes('validation') || errorMsg.includes('parse')) {
      return 'VALIDATION';
    }

    if (errorMsg.includes('api') || errorMsg.includes('401') || errorMsg.includes('403')) {
      return 'API_ERROR';
    }

    return 'UNKNOWN';
  }

  // Check if error is retryable
  static isRetryable(error: unknown): boolean {
    const errorType = ErrorHandler.classifyError(error);

    const retryableErrors: ErrorType[] = ['RATE_LIMIT', 'TIMEOUT', 'NETWORK', 'API_ERROR'];

    return retryableErrors.includes(errorType);
  }

  // Format error for logging
  static formatError(error: unknown, context?: string): string {
    const errorType = ErrorHandler.classifyError(error);
    const errorMsg = error instanceof Error ? error.message : String(error);

    const parts = [
      context ? `[${context}]` : '',
      `Type: ${errorType}`,
      `Message: ${errorMsg}`,
    ].filter(Boolean);

    return parts.join(' - ');
  }
}

export type ErrorType =
  | 'RATE_LIMIT'
  | 'TIMEOUT'
  | 'NETWORK'
  | 'INVALID_FILE'
  | 'VALIDATION'
  | 'API_ERROR'
  | 'UNKNOWN';

// Graceful shutdown handler
export class ShutdownHandler {
  private isShuttingDown = false;
  private shutdownCallbacks: (() => Promise<void>)[] = [];

  constructor() {
    this.setupHandlers();
  }

  private setupHandlers(): void {
    process.on('SIGINT', () => this.shutdown('SIGINT'));
    process.on('SIGTERM', () => this.shutdown('SIGTERM'));
    process.on('uncaughtException', (error) => {
      logger.error('Uncaught exception:', error);
      this.shutdown('uncaughtException');
    });
    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled rejection at:', promise, 'reason:', reason);
      this.shutdown('unhandledRejection');
    });
  }

  onShutdown(callback: () => Promise<void>): void {
    this.shutdownCallbacks.push(callback);
  }

  private async shutdown(signal: string): Promise<void> {
    if (this.isShuttingDown) {
      return;
    }

    this.isShuttingDown = true;
    logger.info(`Received ${signal}, shutting down gracefully...`);

    try {
      // Execute all shutdown callbacks
      for (const callback of this.shutdownCallbacks) {
        await callback();
      }

      logger.info('Shutdown complete');
      process.exit(0);
    } catch (error) {
      logger.error('Error during shutdown:', error);
      process.exit(1);
    }
  }

  isShuttingDownNow(): boolean {
    return this.isShuttingDown;
  }
}
