#!/usr/bin/env bash
# Runs the Go backend for the Go e2e tests (T18B) on a database of its own (carpool_e2e), so the
# Demo reset the tests call never touches the dev database that the Demo and Karate use.
# Needs PostgreSQL from `just infra up`. Usage: backend.sh <port>
set -euo pipefail
cd "$(dirname "$0")/../../../backend"
db=carpool_e2e
user=${POSTGRES_USER:-postgres}
psql() { docker compose -f ../docker-compose.yml exec -T postgres psql -U "$user" -tAc "$1"; }
[ "$(psql "SELECT 1 FROM pg_database WHERE datname = '$db'")" = 1 ] || psql "CREATE DATABASE $db" >/dev/null
GOOSE_DRIVER=postgres GOOSE_MIGRATION_DIR=migrations \
  GOOSE_DBSTRING="postgres://$user:${POSTGRES_PASSWORD:-postgres}@localhost:${POSTGRES_PORT:-5432}/$db?sslmode=disable" \
  go tool goose up >/dev/null
mkdir -p .run
go build -o .run/e2e-server ./cmd/server
exec env DEMO_RESET=1 PORT="$1" POSTGRES_DB="$db" .run/e2e-server
