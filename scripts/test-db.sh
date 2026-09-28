#!/usr/bin/env bash
# Applies the Supabase migrations to a throw-away local PostgreSQL database
# (with a small Supabase shim) and runs the acceptance tests.
# Usage: PGHOST=... PGPORT=... PGUSER=postgres scripts/test-db.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DB=${TEST_DB:-dimo_test}
psql -v ON_ERROR_STOP=1 -q -d postgres -c "drop database if exists $DB" -c "create database $DB"
run() { psql -v ON_ERROR_STOP=1 -q -X -d "$DB" -f "$1"; }
run supabase/tests/local_shim.sql
for f in supabase/migrations/*.sql; do echo "migrate: $f"; run "$f"; done
echo "seed: supabase/seed.sql"; run supabase/seed.sql
if [ -z "${SKIP_TESTS:-}" ]; then echo "tests: supabase/tests/acceptance.sql"; run supabase/tests/acceptance.sql; fi
echo "Done."
