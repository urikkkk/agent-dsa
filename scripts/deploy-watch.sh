#!/usr/bin/env bash
set -euo pipefail

POLL_INTERVAL="${POLL_INTERVAL:-30}"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"

cd "$REPO_DIR"

echo "deploy-watch: monitoring origin/main every ${POLL_INTERVAL}s"
echo "deploy-watch: repo dir = $REPO_DIR"

while true; do
  git fetch origin main --quiet

  LOCAL_SHA=$(git rev-parse HEAD)
  REMOTE_SHA=$(git rev-parse origin/main)

  if [ "$LOCAL_SHA" != "$REMOTE_SHA" ]; then
    echo "$(date '+%H:%M:%S') new commit detected: ${REMOTE_SHA:0:7}"
    git pull --ff-only
    docker compose up -d --build
    echo "$(date '+%H:%M:%S') deploy complete"
  fi

  sleep "$POLL_INTERVAL"
done
