#!/usr/bin/env bash
# Publish database.rules.json with a Node >=20 firebase-tools CLI.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ -x "$ROOT/.tools/node/bin/node" ]]; then
  export PATH="$ROOT/.tools/node/bin:$PATH"
fi

NODE_BIN="$(command -v node || true)"
if [[ -z "$NODE_BIN" ]]; then
  echo "Node.js not found. Install Node 20+ LTS, or use the project binary:" >&2
  echo "  export PATH=\"\$PWD/.tools/node/bin:\$PATH\"" >&2
  exit 1
fi

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if (( NODE_MAJOR < 20 )); then
  echo "firebase-tools needs Node >=20 (found $(node -v) at $NODE_BIN)." >&2
  echo "Switch with one of:" >&2
  if [[ -x "$ROOT/.tools/node/bin/node" ]]; then
    echo "  export PATH=\"\$PWD/.tools/node/bin:\$PATH\"  # $($ROOT/.tools/node/bin/node -v)" >&2
  fi
  echo "  nvm install 20 && nvm use 20" >&2
  echo "  fnm use 20" >&2
  exit 1
fi

npm run rules:generate

FIREBASE_BIN="$ROOT/node_modules/.bin/firebase"
if [[ ! -x "$FIREBASE_BIN" ]]; then
  echo "Missing local firebase CLI. Run: npm ci" >&2
  exit 1
fi

PROJECT_ID="${FIREBASE_PROJECT_ID:-hidden-pictures-11613}"
echo "Using Node $(node -v); deploying RTDB rules to project ${PROJECT_ID}"
exec "$FIREBASE_BIN" deploy --only database --project "$PROJECT_ID" "$@"
