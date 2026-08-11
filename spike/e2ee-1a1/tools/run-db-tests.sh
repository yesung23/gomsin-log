#!/usr/bin/env bash
# TEST ONLY — rebuild a throwaway database, apply migrations 031/032, run the
# behaviour and actor-matrix tests. Never points at production.
set -euo pipefail

HOST=127.0.0.1
PORT=${SPIKE_PG_PORT:-55432}
USER=${SPIKE_PG_USER:-spike}
DB=e2ee_test
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

if [ "$HOST" != "127.0.0.1" ]; then
  echo "refusing to run against a non-local host" >&2
  exit 2
fi

psql -h "$HOST" -p "$PORT" -U "$USER" -d postgres -q -tAc "DROP DATABASE IF EXISTS $DB;" >/dev/null
psql -h "$HOST" -p "$PORT" -U "$USER" -d postgres -q -tAc "CREATE DATABASE $DB;" >/dev/null

run() { psql -h "$HOST" -p "$PORT" -U "$USER" -d "$DB" -v ON_ERROR_STOP=1 -q -f "$1" >/dev/null; }

run "$ROOT/spike/e2ee-1a1/tools/db-harness.sql"
run "$ROOT/supabase/migrations/031_e2ee_key_foundation.sql"
run "$ROOT/supabase/migrations/032_e2ee_write_floor.sql"

psql -h "$HOST" -p "$PORT" -U "$USER" -d "$DB" -v ON_ERROR_STOP=1 \
  -f "$ROOT/spike/e2ee-1a1/tools/db-tests-v2.sql" 2>&1
