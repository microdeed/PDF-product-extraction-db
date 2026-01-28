import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import { env } from '../config/env.js';
import path from 'path';
import { mkdirSync } from 'fs';

// Ensure log directory exists
try {
  mkdirSync(env.LOG_DIR, { recursive: true });
} catch (error) {
  // Directory already exists or cannot be created
}

// Define log format
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.printf(({ timestamp, level, message, stack }) => {
    if (stack) {
      return `${timestamp} [${level.toUpperCase()}]: ${message}\n${stack}`;
    }
    return `${timestamp} [${level.toUpperCase()}]: ${message}`;
  })
);

// Console format with colors
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message }) => {
    return `${timestamp} ${level}: ${message}`;
  })
);

// Create logger instance
const logger = winston.createLogger({
  level: env.LOG_LEVEL,
  format: logFormat,
  transports: [
    // Console transport
    new winston.transports.Console({
      format: consoleFormat,
    }),
    // Daily rotate file for all logs
    new DailyRotateFile({
      filename: path.join(env.LOG_DIR, 'application-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '14d',
      format: logFormat,
    }),
    // Daily rotate file for error logs only
    new DailyRotateFile({
      filename: path.join(env.LOG_DIR, 'error-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      level: 'error',
      maxSize: '20m',
      maxFiles: '30d',
      format: logFormat,
    }),
  ],
});

// Add request/response logging helpers
export const logApiRequest = (productCode: string, pdfPath: string) => {
  logger.info(`API Request: Processing ${productCode} from ${pdfPath}`);
};

export const logApiResponse = (productCode: string, success: boolean, duration: number) => {
  logger.info(`API Response: ${productCode} - ${success ? 'SUCCESS' : 'FAILED'} (${duration}ms)`);
};

export const logProcessingStart = (totalFiles: number) => {
  logger.info(`Starting batch processing: ${totalFiles} PDFs to process`);
};

export const logProcessingComplete = (successCount: number, failCount: number, duration: number) => {
  logger.info(`Batch processing complete: ${successCount} succeeded, ${failCount} failed (${duration}ms)`);
};

export default logger;
