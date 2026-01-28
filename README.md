# PDF Product Information Extraction System

An automated system for extracting structured product information from PDF files using Anthropic's Claude Vision API and storing it in a SQLite database.

## Overview

This system processes product information PDFs, extracts key data using AI vision capabilities, validates and normalizes the data, and stores it in a structured database. It's designed to handle ~120 PDF files with built-in error handling, retry logic, and quality reporting.

## Features

- **Automated PDF Discovery**: Recursively scans directories for product information PDFs
- **AI-Powered Extraction**: Uses Claude Vision API to extract structured data from PDFs
- **Robust Error Handling**: Automatic retry logic with exponential backoff
- **Rate Limiting**: Respects API rate limits (configurable requests per minute)
- **Data Validation**: Zod schemas ensure data integrity
- **Progress Tracking**: Real-time progress updates during batch processing
- **Quality Reporting**: Comprehensive reports on extraction success rates and data completeness
- **Concurrent Processing**: Process multiple PDFs in parallel (configurable concurrency)
- **SQLite Database**: Structured storage with foreign key relationships

## Technology Stack

- **Runtime**: Node.js with TypeScript
- **Database**: SQLite (better-sqlite3)
- **AI**: Anthropic Claude Vision API (claude-sonnet-4-5-20250929)
- **Validation**: Zod
- **Logging**: Winston with daily rotation
- **File Scanning**: glob

## Quick Start with Docker

### Prerequisites
- Docker and Docker Compose installed
- Your `.env` file configured with `ANTHROPIC_API_KEY`

### Running with Docker Compose

1. Create your `.env` file:
```bash
cp .env.example .env
# Edit .env and add your ANTHROPIC_API_KEY
```

2. Start the application:
```bash
docker-compose up -d
```

3. Access the API at `http://localhost:3001`

4. Verify the health endpoint:
```bash
curl http://localhost:3001/health
```

### Building Manually

```bash
# Build the image
docker build -t pdf-extractor .

# Run the container
docker run -p 3001:3001 \
  -v $(pwd)/products.db:/app/products.db \
  -v $(pwd)/products:/app/products:ro \
  -v $(pwd)/logs:/app/logs \
  --env-file .env \
  pdf-extractor
```

### Volume Mounts

| Mount | Description |
|-------|-------------|
| `./products.db:/app/products.db` | SQLite database (persistent storage) |
| `./products:/app/products:ro` | PDF files directory (read-only) |
| `./logs:/app/logs` | Application logs |

---

## Local Installation

1. Clone the repository and navigate to the project directory:
```bash
cd E:\AI-Code\productDb
```

2. Install dependencies:
```bash
npm install
```

3. Configure environment variables (copy `.env.example` to `.env` and fill in values):
```bash
cp .env.example .env
```

4. Edit `.env` and add your Anthropic API key:
```env
ANTHROPIC_API_KEY=your_api_key_here
PDF_ROOT_PATH=./products
DATABASE_PATH=./products.db
CONCURRENT_PROCESSES=5
MAX_RETRIES=3
RATE_LIMIT_PER_MINUTE=50
```

5. Build the project:
```bash
npm run build
```

## Usage

### Verify System Setup

Check that everything is configured correctly:
```bash
npm run verify
```

This will:
- Scan for PDF files
- Check database connectivity
- Verify configuration
- Report on system status

### Process All PDFs

Extract data from all PDFs in the configured directory:
```bash
npm run process
```

Features:
- Automatically skips already-processed PDFs
- Processes multiple PDFs concurrently
- Shows real-time progress
- Generates quality report when complete

### Retry Failed Extractions

Retry products that failed during initial processing:
```bash
npm run retry
```

### Generate Quality Report

View statistics on extraction success and data completeness:
```bash
npm run report
```

### Development Mode

Run without building:
```bash
npm run dev
```

## Project Structure

```
E:\AI-Code\productDb\
├── src/
│   ├── index.ts                    # Main CLI entry point
│   ├── config/
│   │   ├── database.ts             # SQLite connection & initialization
│   │   └── env.ts                  # Environment variable validation
│   ├── scanner/
│   │   ├── pdf-scanner.ts          # Recursive PDF discovery
│   │   └── file-parser.ts          # Extract product codes & subbrands
│   ├── extractor/
│   │   ├── ai-extractor.ts         # Anthropic Vision API integration
│   │   ├── prompt-builder.ts       # Construct extraction prompts
│   │   └── pdf-converter.ts        # PDF to base64 for Vision API
│   ├── parser/
│   │   ├── json-validator.ts       # Zod schemas & validation
│   │   └── data-normalizer.ts      # Clean & normalize extracted data
│   ├── database/
│   │   ├── schema.ts               # Database schema & migrations
│   │   └── repository.ts           # CRUD operations
│   ├── processor/
│   │   ├── batch-processor.ts      # Orchestrate batch processing
│   │   └── error-handler.ts        # Error recovery & retry logic
│   └── utils/
│       ├── logger.ts               # Winston logger setup
│       └── progress-tracker.ts     # Track processing progress
├── package.json
├── tsconfig.json
├── .env                            # Configuration (not in git)
└── products.db                     # SQLite database (generated)
```

## Database Schema

### Core Tables

**products** - Main product information
- Product code, name, description, slogan
- Directions, caution, references
- PDF file path and folder structure
- Extraction status and error tracking
- Raw AI response for debugging

**supplement_facts** - Nutritional information (1-to-1 with products)
- Servings, servings per container
- Calories, protein
- Foreign key to products

**nutritional_values** - Individual nutrients (many-to-1 with supplement_facts)
- Nutrient name, amount, daily value percentage
- Display order for maintaining sequence

**ingredients** - Product ingredients (many-to-1 with products)
- Ingredient name, organic flag
- Display order for maintaining sequence

**dietary_attributes** - Dietary certifications (many-to-many with products)
- Attribute names (vegan, gluten-free, etc.)

**processing_log** - Audit trail
- Processing actions, status, timing
- Error messages for failed operations

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `ANTHROPIC_API_KEY` | Anthropic API key (required) | - |
| `DATABASE_PATH` | SQLite database file path | `./products.db` |
| `PDF_ROOT_PATH` | Root directory containing PDFs | `./products` |
| `CONCURRENT_PROCESSES` | Number of PDFs to process simultaneously | `5` |
| `MAX_RETRIES` | Max retry attempts for failed operations | `3` |
| `RATE_LIMIT_PER_MINUTE` | API requests per minute limit | `50` |
| `AI_MODEL` | Claude model to use | `claude-sonnet-4-5-20250929` |
| `AI_MAX_TOKENS` | Max tokens for AI responses | `4096` |
| `AI_TEMPERATURE` | AI temperature (0 = deterministic) | `0` |
| `LOG_LEVEL` | Logging level (error, warn, info, debug) | `info` |
| `LOG_DIR` | Directory for log files | `./logs` |

## PDF File Naming Convention

PDFs must follow this naming pattern:
```
<product_code>-PI_EN.pdf
```

Examples:
- `358-PI_EN.pdf`
- `0358-PI_EN.pdf`
- `123456-PI_EN.pdf`

Product codes can be 3-6 digits and may have leading zeros.

## Folder Structure Support

The system supports nested folder structures for subbrands:

```
products/
├── 0358 Yummies/
│   └── 0358-PI_EN.pdf           # No subbrand
├── LifePlus Kids/
│   └── 0359 Yummies/
│       └── 0359-PI_EN.pdf       # Subbrand: "LifePlus Kids"
```

## Extracted Data Structure

The system extracts the following information:

- **Product Information**: Name, slogan, description
- **Supplement Facts**: Serving size, calories, protein, nutritional values
- **Ingredients**: Complete list with organic flags
- **Usage Information**: Directions for use
- **Safety Information**: Caution statements
- **Dietary Attributes**: Vegan, gluten-free, organic, etc.
- **References**: Citations and additional notes

## Error Handling

The system includes comprehensive error handling:

- **Retry Logic**: Automatic retries with exponential backoff
- **Rate Limiting**: Respects API limits to avoid throttling
- **Partial Extraction**: Salvages usable data from partial failures
- **Error Logging**: Detailed error messages in database and logs
- **Graceful Shutdown**: Handles interruptions cleanly

## Quality Metrics

The system tracks:

- Extraction success rate (target: ≥95%)
- Data completeness percentage (target: ≥90%)
- Processing time per PDF
- Average ingredients per product
- Products with complete supplement facts

## Logging

Logs are stored in the `logs/` directory:

- `application-YYYY-MM-DD.log` - All logs
- `error-YYYY-MM-DD.log` - Error logs only
- Daily rotation with 14-day retention
- Console output with color coding

## Troubleshooting

### No PDFs Found

Check that:
- `PDF_ROOT_PATH` is set correctly
- PDFs follow naming convention: `*-PI_EN.pdf`
- File permissions allow reading

### API Errors

Check that:
- `ANTHROPIC_API_KEY` is valid
- API rate limits are not exceeded
- Network connectivity is stable

### Database Errors

Check that:
- Database file is not locked by another process
- Disk space is available
- File permissions allow read/write

### Low Extraction Success

If extraction rate is low:
1. Check PDF quality (readable text, clear images)
2. Review error logs for patterns
3. Try reducing concurrency
4. Use retry command for failed products

## Performance

Expected performance metrics:

- Processing speed: ~2-5 seconds per PDF
- Concurrency: 5 PDFs in parallel (configurable)
- Total time for 120 PDFs: ~8-20 minutes
- Memory usage: ~200-500 MB
- Database size: ~10-50 MB

## Development

### Running Tests

```bash
npm run dev verify
```

### Building

```bash
npm run build
```

### Linting

TypeScript compilation serves as linting:
```bash
npm run build
```

## License

MIT

## Support

For issues or questions, check the logs in the `logs/` directory or review the processing log in the database.

## Success Criteria

- ✓ All PDFs scanned and discovered
- ✓ 95%+ successful extractions (114+ out of 120 products)
- ✓ All database tables populated with relationships intact
- ✓ 90%+ data completeness (fields populated)
- ✓ Quality report generated with metrics
- ✓ Error log available for failed extractions
- ✓ Database queryable for product information

## Next Steps

1. Place your PDF files in the `products/` directory
2. Run `npm run verify` to check setup
3. Run `npm run process` to start extraction
4. Review quality report
5. Retry any failures with `npm run retry`
6. Query the `products.db` SQLite database for results
