# Rise Path VM stack images (build from repo root)
#   docker build -f deploy/risepath-vm/Dockerfile --target api .
#   docker build -f deploy/risepath-vm/Dockerfile --target mcp .

# --- API: Express. The front end is built and served by Vercel, so this image has no dist/ ---
FROM node:22-slim AS api

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --ignore-scripts

COPY server.js ./
COPY server/ ./server/
COPY tools/ ./tools/
COPY shared/ ./shared/
COPY content/ ./content/
COPY scripts/ ./scripts/
COPY public/ ./public/
COPY data/ ./data/
# Uploaded materials (server/uploads.js): the uploads volume is mounted here and starts with this
# directory's mode, so only the server's user can list it.
RUN mkdir -m 700 /app/uploads

ENV NODE_ENV=production
ENV PORT=3006
EXPOSE 3006

CMD ["node", "server.js"]

# --- MCP: SSE server (mcp) and the public remote endpoint (mcp-public: node mcp-server/index.js --http) ---
FROM node:22-slim AS mcp

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --ignore-scripts

COPY mcp-server/ ./mcp-server/
COPY tools/ ./tools/
COPY shared/ ./shared/
COPY content/ ./content/
COPY server/ ./server/
COPY scripts/ ./scripts/
COPY agents/ ./agents/
COPY skills/ ./skills/
COPY data/ ./data/

ENV NODE_ENV=production
EXPOSE 3100

CMD ["node", "mcp-server/index.js", "--sse", "3100"]