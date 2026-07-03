# === Rise Path Production Dockerfile ===
# Multi-stage build: build frontend, then serve via Express

# Stage 1: Build frontend
FROM node:22-slim AS builder

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts

COPY . .

ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_DEMO_MODE=false
ARG VITE_API_ENABLED=true

ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY
ENV VITE_DEMO_MODE=$VITE_DEMO_MODE
ENV VITE_API_ENABLED=$VITE_API_ENABLED

RUN npm run build

# Stage 2: Production server
FROM node:22-slim AS production

WORKDIR /app

# Copy package files and install production deps only
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --ignore-scripts

# Copy server code
COPY server.js ./
COPY server/ ./server/
COPY scripts/ ./scripts/
COPY public/ ./public/

# Copy built frontend from builder
COPY --from=builder /app/dist ./dist

# Data directories
COPY data/ ./data/

ENV NODE_ENV=production
ENV PORT=3006

EXPOSE 3006

CMD ["node", "server.js"]
