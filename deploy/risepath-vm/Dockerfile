# Rise Path VM stack images (build from repo root)
#   docker build -f deploy/risepath-vm/Dockerfile --target api .
#   docker build -f deploy/risepath-vm/Dockerfile --target mcp .

# --- API: Express + built frontend ---
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

RUN npm run build:prod

FROM node:22-slim AS api

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --ignore-scripts

COPY server.js ./
COPY server/ ./server/
COPY tools/ ./tools/
COPY scripts/ ./scripts/
COPY public/ ./public/
COPY data/ ./data/
COPY --from=builder /app/dist ./dist

ENV NODE_ENV=production
ENV PORT=3006
EXPOSE 3006

CMD ["node", "server.js"]

# --- MCP: SSE server ---
FROM node:22-slim AS mcp

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --ignore-scripts

COPY mcp-server/ ./mcp-server/
COPY tools/ ./tools/
COPY server/ ./server/
COPY scripts/ ./scripts/
COPY agents/ ./agents/
COPY skills/ ./skills/
COPY data/ ./data/

ENV NODE_ENV=production
EXPOSE 3100

CMD ["node", "mcp-server/index.js", "--sse", "3100"]