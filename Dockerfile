# Build stage
FROM node:20-alpine AS builder

LABEL org.opencontainers.image.source=https://github.com/microdeed/productDb
WORKDIR /app

# Install build dependencies for better-sqlite3
RUN apk add --no-cache python3 make g++

# Install root dependencies and build
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# API build
WORKDIR /app/api
COPY api/package*.json ./
RUN npm ci
RUN npm run build

# Frontend build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
RUN npm run build

# Production stage
FROM node:20-alpine
WORKDIR /app

# Install runtime dependencies for better-sqlite3
RUN apk add --no-cache python3 make g++

# Install root production dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy built artifacts
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/api/dist ./api/dist
COPY --from=builder /app/api/package*.json ./api/
COPY --from=builder /app/frontend/dist ./frontend/dist

# Install API production dependencies
WORKDIR /app/api
RUN npm ci --omit=dev

WORKDIR /app

EXPOSE 3001

CMD ["node", "api/dist/index.js"]
