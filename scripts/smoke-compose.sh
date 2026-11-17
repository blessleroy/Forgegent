#!/usr/bin/env bash
# AT-20 deployment smoke (task 4.6, D47): build images, boot compose with a
# LOCAL MOCK OpenAI-compatible endpoint (deployment wiring is under test —
# model quality is not; the mock boundary is stated in the log), seed the
# demo workspace, and drive the full employee closed loop. Exit code mirrors
# the result. Requires docker compose v2 + node ≥22.
set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${SMOKE_MOCK_PORT:-8901}"
export FORGEGENT_SEED_DEMO=1
export FORGEGENT_MODEL_BASE_URL="http://host.docker.internal:${PORT}/v1"
export FORGEGENT_MODEL_NAME="mock-chat"
export FORGEGENT_MODEL_API_KEY="smoke-key"
export FORGEGENT_ADMIN_EMAIL="smoke-admin@forgegent.local"
export FORGEGENT_ADMIN_PASSWORD="smoke-init-pass-123"
export BETTER_AUTH_SECRET="smoke-secret-not-for-prod"

echo "[smoke-compose] starting mock model endpoint on :${PORT}"
node "scripts/mock-model-server.mjs" &
MOCK_PID=$!
trap 'kill $MOCK_PID 2>/dev/null || true; docker compose down -v >/dev/null 2>&1 || true' EXIT

echo "[smoke-compose] building + starting compose (web + runner)"
docker compose up -d --build --wait

echo "[smoke-compose] driving closed loop (employee → task → artifact)"
node scripts/smoke-run.mjs
STATUS=$?

echo "[smoke-compose] exit ${STATUS} — mock model channel (D47), wiring under test"
exit $STATUS
