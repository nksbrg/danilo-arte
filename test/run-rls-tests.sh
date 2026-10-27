#!/usr/bin/env bash
# Esegue le policy RLS reali (supabase/migrations/) contro un database
# PostgreSQL locale "nudo", con una emulazione minima di auth/storage di
# Supabase (supabase/tests/_shim_supabase_auth.sql). NON è un test contro un
# vero progetto Supabase: niente GoTrue, niente MFA reale. Verifica però, con
# query reali e policy reali, che le regole di autorizzazione si comportino
# come documentato (vedi README-SUPABASE.md per i limiti di questo test).
#
# Richiede: un server PostgreSQL raggiungibile come superuser (locale, uso
# tipico in sviluppo). Se non disponibile, lo script esce con un messaggio
# chiaro invece di dichiarare un successo non verificato.
set -euo pipefail

DB_NAME="${RLS_TEST_DB:-danilo_rls_test}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

psql_super() {
  if [ "$(id -u)" = "0" ] && id postgres >/dev/null 2>&1; then
    local cmd
    cmd=$(printf '%q ' psql "$@")
    su postgres -c "$cmd"
  else
    psql "$@"
  fi
}

if ! command -v psql >/dev/null 2>&1; then
  echo "[run-rls-tests] psql non trovato: test RLS SALTATO (non superato, non fallito)." >&2
  exit 0
fi

if ! psql_super -c 'select 1' >/dev/null 2>&1; then
  echo "[run-rls-tests] Nessun server PostgreSQL raggiungibile: test RLS SALTATO." >&2
  echo "[run-rls-tests] (non è un fallimento: significa solo che qui non è stato verificato)" >&2
  exit 0
fi

echo "[run-rls-tests] Ricreo il database di test '$DB_NAME'..."
psql_super -c "drop database if exists ${DB_NAME}" >/dev/null
psql_super -c "drop role if exists anon" >/dev/null 2>&1 || true
psql_super -c "drop role if exists authenticated" >/dev/null 2>&1 || true
psql_super -c "create database ${DB_NAME}" >/dev/null

run_sql() {
  psql_super -d "${DB_NAME}" -v ON_ERROR_STOP=1 -f "$1"
}

echo "[run-rls-tests] Applico lo shim auth/storage..."
run_sql "${REPO_ROOT}/supabase/tests/_shim_supabase_auth.sql" >/dev/null

echo "[run-rls-tests] Applico le migrazioni reali..."
for f in "${REPO_ROOT}"/supabase/migrations/*.sql; do
  run_sql "$f" >/dev/null
done

echo "[run-rls-tests] Eseguo le asserzioni RLS..."
run_sql "${REPO_ROOT}/supabase/tests/rls.sql"

echo "[run-rls-tests] Eseguo le asserzioni di hardening (search_path, rls_auto_enable)..."
run_sql "${REPO_ROOT}/supabase/tests/hardening.sql"

echo "[run-rls-tests] Pulizia..."
psql_super -c "drop database if exists ${DB_NAME}" >/dev/null

echo "[run-rls-tests] OK: tutti i test RLS e di hardening superati."
