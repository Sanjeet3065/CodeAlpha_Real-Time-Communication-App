# =================================================================
# CONNECTLY — Production Multi-Stage Backend Dockerfile
# Phase 18: Zero-Budget Deployment Foundation
# =================================================================

# -----------------------------------------------------------------
# Stage 1: Build & Compile TypeScript
# -----------------------------------------------------------------
FROM node:20-alpine AS builder

WORKDIR /app

# Copy root workspace and server manifests for reproducible dependency resolution
COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY client/package.json ./client/

# Install all dependencies (including devDependencies needed for build)
RUN npm ci

# Copy server source code and TypeScript configuration
COPY server/src ./server/src
COPY server/tsconfig.json ./server/

# Compile TypeScript to JavaScript in /app/server/dist
RUN npm run build --workspace=server

# Prune development dependencies to retain only production dependencies
RUN npm prune --omit=dev

# -----------------------------------------------------------------
# Stage 2: Production Minimal Runtime
# -----------------------------------------------------------------
FROM node:20-alpine AS runner

WORKDIR /app

# Security: Set production environment
ENV NODE_ENV=production
ENV PORT=5000

# Install dumb-init or use standard node for graceful PID 1 signal handling
RUN apk add --no-cache dumb-init

# Copy root package.json and production dependencies from builder
COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/server/package.json ./server/
COPY --from=builder /app/server/dist ./server/dist

WORKDIR /app/server

# Security: Run as non-root user 'node' (UID/GID 1000)
USER node

# Document exposed backend port
EXPOSE 5000

# Docker native liveness healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://localhost:5000/api/v1/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

# Start the CONNECTLY API server under dumb-init
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "dist/server.js"]
