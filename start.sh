#!/bin/bash
set -e

ROOT="/home/runner/workspace"

if [ ! -d "$ROOT/node_modules" ]; then
  echo "=== Installing root dependencies ==="
  cd "$ROOT" && npm install --silent
fi

if [ ! -d "$ROOT/server/node_modules" ]; then
  echo "=== Installing server dependencies ==="
  cd "$ROOT/server" && npm install --silent
fi

if [ ! -d "$ROOT/server/node_modules/.prisma" ]; then
  echo "=== Generating Prisma client ==="
  cd "$ROOT/server" && npx prisma generate
fi

echo "=== Pushing database schema ==="
cd "$ROOT/server" && npx prisma db push --skip-generate 2>&1

if [ ! -d "$ROOT/client/node_modules" ]; then
  echo "=== Installing client dependencies ==="
  cd "$ROOT/client" && npm install --silent
fi

echo "=== Starting server ==="
cd "$ROOT/server" && npx tsx src/index.ts &

echo "=== Starting client ==="
cd "$ROOT/client" && npx vite --host 0.0.0.0 --port 5000 &

wait
