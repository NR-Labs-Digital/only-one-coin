#!/usr/bin/env bash
# Restores one of the production backups (the pg_dump the API deploy writes to
# Tigris before every migration, .github/workflows/deploy-api.yml) into a
# database you point it at, then checks what came back (OOC-50).
#
# Runbook: docs/INFRAESTRUTURA.md, "Restaurar um backup".
#
# The target must be an EMPTY database: a scratch Neon branch created for the
# drill, or a local one. The script refuses a target that already has tables,
# which is what keeps it from ever writing over production (production is
# never empty). The restored data is real production data (Ley 29733): drop
# the target when the drill is over, and never point this at staging, which
# never receives real data (CLAUDE.md §7).
#
# Usage:
#   scripts/restore-backup.sh --target <postgres-url> [--key <object>] [--file <dump.sql.gz>] [--skip-acl] [--yes]
#
#   --target    Connection string of the empty database to restore into.
#   --key       Object name in the bucket (ooc-prod-YYYYMMDDTHHMMSSZ.sql.gz).
#               Default: the most recent one.
#   --file      A dump already on disk instead of the bucket (no Tigris needed).
#   --skip-acl  Also drop GRANT/REVOKE lines — for a target where the roles
#               the dump grants to (ooc_app) do not exist.
#   --yes       Skip the confirmation prompt (CI / scripted drills).
#
# Environment (only when reading from the bucket):
#   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY   Tigris keys that can read the bucket
#   AWS_ENDPOINT_URL_S3                         default https://t3.storage.dev
#   TIGRIS_BUCKET_NAME                          default only-one-coin-backups
#   PG_BIN      Directory holding psql 18 (e.g. /usr/lib/postgresql/18/bin).
#               Without it and without psql on PATH, psql runs from the
#               postgres:18-alpine image through docker.

set -euo pipefail

TARGET=""
KEY=""
FILE=""
SKIP_ACL=0
ASSUME_YES=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target) TARGET="${2:-}"; shift 2 ;;
    --key) KEY="${2:-}"; shift 2 ;;
    --file) FILE="${2:-}"; shift 2 ;;
    --skip-acl) SKIP_ACL=1; shift ;;
    --yes) ASSUME_YES=1; shift ;;
    -h|--help) sed -n '2,35p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

if [[ -z "$TARGET" ]]; then
  echo "Missing --target <postgres-url>." >&2
  exit 2
fi
if [[ -n "$KEY" && -n "$FILE" ]]; then
  echo "Use --key or --file, not both." >&2
  exit 2
fi

BUCKET="${TIGRIS_BUCKET_NAME:-only-one-coin-backups}"
ENDPOINT="${AWS_ENDPOINT_URL_S3:-https://t3.storage.dev}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# psql: PG_BIN, then PATH, then the postgres:18 image. The dump comes from a
# Postgres 18 server (Neon), so an older psql is refused rather than trusted.
if [[ -n "${PG_BIN:-}" ]]; then
  PSQL=("$PG_BIN/psql")
elif command -v psql >/dev/null 2>&1; then
  PSQL=(psql)
elif command -v docker >/dev/null 2>&1; then
  PSQL=(docker run --rm -i --network host postgres:18-alpine psql)
else
  echo "No psql 18: set PG_BIN, install postgresql-client-18, or install docker." >&2
  exit 1
fi

client_major="$("${PSQL[@]}" --version | sed -E 's/[^0-9]*([0-9]+).*/\1/')"
if [[ "$client_major" -lt 18 ]]; then
  echo "psql $client_major is older than the server that wrote the dump (18)." >&2
  exit 1
fi

psql_target() {
  "${PSQL[@]}" "$TARGET" -X -q -v ON_ERROR_STOP=1 "$@"
}

echo "==> Checking the target"
target_db="$(psql_target -At -c 'select current_database()')"
tables="$(psql_target -At -c "select count(*) from information_schema.tables where table_schema not in ('pg_catalog', 'information_schema')")"
if [[ "$tables" != "0" ]]; then
  echo "Refused: database \"$target_db\" already has $tables tables." >&2
  echo "Restore only into an empty database — a scratch branch or a fresh local one." >&2
  exit 1
fi
echo "    \"$target_db\" is empty."

echo "==> Getting the dump"
if [[ -n "$FILE" ]]; then
  cp "$FILE" "$WORK/dump.sql.gz"
  SOURCE="$FILE"
else
  if [[ -z "$KEY" ]]; then
    # Names carry a UTC timestamp, so the last one in order is the newest.
    KEY="$(aws s3 ls "s3://$BUCKET/" --endpoint-url "$ENDPOINT" \
      | awk '{print $4}' | grep -E '^ooc-prod-[0-9]{8}T[0-9]{6}Z\.sql\.gz$' | sort | tail -n 1)"
    if [[ -z "$KEY" ]]; then
      echo "No ooc-prod-*.sql.gz in s3://$BUCKET." >&2
      exit 1
    fi
  fi
  aws s3 cp "s3://$BUCKET/$KEY" "$WORK/dump.sql.gz" --endpoint-url "$ENDPOINT" --only-show-errors
  SOURCE="s3://$BUCKET/$KEY"
fi
gzip -t "$WORK/dump.sql.gz"
echo "    $SOURCE ($(du -h "$WORK/dump.sql.gz" | cut -f1) compressed)"

if [[ "$ASSUME_YES" -ne 1 ]]; then
  echo
  echo "This writes REAL production data into \"$target_db\"."
  echo "Drop it when the drill is over."
  read -r -p "Type the database name to go on: " answer
  if [[ "$answer" != "$target_db" ]]; then
    echo "Cancelled." >&2
    exit 1
  fi
fi

echo "==> Restoring"
# The dump names the production owner role, which the target does not have:
# ownership lines are dropped and every object belongs to whoever restores.
# The rest stops on the first error — a half-restored database is not a
# passed drill.
filter='/^ALTER .* OWNER TO /d'
if [[ "$SKIP_ACL" -eq 1 ]]; then
  filter="$filter;/^(GRANT|REVOKE) /d;/^ALTER DEFAULT PRIVILEGES /d"
fi
started=$(date +%s)
gunzip -c "$WORK/dump.sql.gz" | sed -E "$filter" | psql_target -1 >/dev/null
echo "    done in $(( $(date +%s) - started ))s, in one transaction."

echo "==> Checking what came back"
echo "    Rows per table:"
for table in students guardians enrollments payments class_groups courses teachers grades audit_log; do
  exists="$(psql_target -At -c "select to_regclass('public.$table') is not null")"
  if [[ "$exists" == "t" ]]; then
    printf '      %-14s %s\n' "$table" "$(psql_target -At -c "select count(*) from public.$table")"
  else
    printf '      %-14s %s\n' "$table" "(not in this backup)"
  fi
done

applied="$(psql_target -At -c 'select count(*) from drizzle.__drizzle_migrations' 2>/dev/null || echo "?")"
in_repo="$(grep -c '"tag"' "$ROOT/packages/db/migrations/meta/_journal.json" || true)"
echo "    Migrations in the backup: $applied (the repo has $in_repo)."
echo "    The backup runs before the deploy's migration, so it can be one or more behind."

echo "    Append-only lock (migration 0011):"
if psql_target -c "update audit_log set action = action where false" >/dev/null 2>&1; then
  echo "      NOT enforced: an UPDATE on audit_log went through." >&2
  exit 1
fi
echo "      UPDATE on audit_log refused, as it should be."

echo
echo "Restored $SOURCE into \"$target_db\". Record the result in OOC-50, then drop the target."
