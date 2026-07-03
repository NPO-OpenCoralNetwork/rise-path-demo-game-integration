#!/usr/bin/env bash
# Pull Ollama embedding model for Rise Path Memanto overlay (Phase 19-0).
# Run on risepath-vm after memory stack is up.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STACK_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "${STACK_DIR}"

if [[ -f stack.env ]]; then
  set -a
  # shellcheck disable=SC1091
  source stack.env
  set +a
fi

MODEL="${MOORCHEH_EMBEDDING_MODEL:-nomic-embed-text}"
COMPOSE_FILES=(-f docker-compose.yml -f docker-compose.memanto.yml)

echo "==> Pulling Ollama model: ${MODEL}"
docker compose --env-file stack.env "${COMPOSE_FILES[@]}" \
  exec -T ollama ollama pull "${MODEL}"

echo "==> Optional LLM model for Memanto answer (v2): ${MOORCHEH_LLM_MODEL:-qwen2.5:0.5b}"
docker compose --env-file stack.env "${COMPOSE_FILES[@]}" \
  exec -T ollama ollama pull "${MOORCHEH_LLM_MODEL:-qwen2.5:0.5b}" || true

echo "==> Done"