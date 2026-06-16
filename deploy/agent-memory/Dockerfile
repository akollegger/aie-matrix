# syntax=docker/dockerfile:1
# agent-memory service: neo4j-agent-memory MCP server (Neo4j Labs)
# run as a shared, multi-tenant SSE service (k8s-scalable). Peppers ghosts
# connect over SSE (PEPPERS_MEMORY_MCP_URL); memory is its own deployable.
#
# Backed by the shared world Neo4j ("context graph in the same instance").
# All OpenAI-shaped calls (embeddings + extraction LLM) route via OpenRouter.

FROM python:3.12-slim

# uv/uvx from the official image — fast, reproducible Python tool runner.
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

ENV UV_CACHE_DIR=/opt/uv-cache \
    UV_LINK_MODE=copy \
    UV_PYTHON_INSTALL_DIR=/opt/uv-python

# Pre-resolve the package into the uv cache so the first request doesn't
# pay a cold download. Tolerate non-zero (no Neo4j at build time).
RUN uvx --from "neo4j-agent-memory[openai,mcp]" neo4j-agent-memory --help >/dev/null 2>&1 || true

EXPOSE 8080

# Shell-form CMD so env vars expand. Neo4j password via NEO4J_PASSWORD;
# OpenAI SDK (embeddings + LLM) reads OPENAI_API_KEY + OPENAI_BASE_URL
# (set to OpenRouter in the compose). --backend bolt = direct Neo4j.
CMD uvx --from "neo4j-agent-memory[openai,mcp]" neo4j-agent-memory mcp serve \
    --transport sse --host 0.0.0.0 --port 8080 \
    --backend bolt \
    --uri "${NEO4J_URI:-bolt://neo4j:7687}" \
    --user "${NEO4J_USER:-neo4j}" \
    --profile extended \
    --embedding "${MEMORY_EMBEDDING:-openai/text-embedding-3-small}" \
    --llm "${MEMORY_LLM:-openai/gpt-4o-mini}" \
    --llm-api-base "${OPENAI_BASE_URL:-https://openrouter.ai/api/v1}"
