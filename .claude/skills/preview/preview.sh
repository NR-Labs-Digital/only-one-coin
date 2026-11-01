#!/usr/bin/env bash
# Local preview: brings the stack up (Docker services, migrations, API, app),
# signs a local preview account in and opens a browser already in session.
#
#   preview.sh [role] [path]
#   role  enrollment_supervisor (default) | academic_supervisor | analyst | sales | support
#   path  where to land, default /backoffice/home
#
# Local only: the account comes from `seed:preview`, which refuses any
# database that is not on this machine.
set -euo pipefail

ROLE="${1:-enrollment_supervisor}"
LAND="${2:-/backoffice/home}"
ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
OUT="$ROOT/tmp/preview"
APP=http://localhost:3000
API=http://localhost:3333
PLAYWRIGHT=playwright@1.63.0
mkdir -p "$OUT"
cd "$ROOT"

up() { curl -s -o /dev/null --max-time 3 "$1"; }

wait_for() { # url seconds label log
  for _ in $(seq 1 "$2"); do up "$1" && return 0; sleep 1; done
  echo "✗ $3 did not answer at $1 — see $4" >&2
  exit 1
}

echo "→ Docker services"
# The containers already exist under the compose project's names; starting
# them keeps their data. A fresh machine has none, so compose creates them.
if ! docker start only-one-coin_postgres_1 only-one-coin_redis_1 only-one-coin_s3_1 >/dev/null 2>&1; then
  docker compose up -d postgres redis s3
fi
for _ in $(seq 1 30); do
  docker exec only-one-coin_postgres_1 pg_isready -U ooc -d ooc_dev >/dev/null 2>&1 && break
  sleep 1
done

echo "→ Migrations"
pnpm --filter @ooc/db -s db:migrate >"$OUT/migrate.log" 2>&1 || { echo "✗ migrations failed — see $OUT/migrate.log" >&2; exit 1; }

if up "$API/health"; then
  echo "→ API already running"
else
  echo "→ Starting the API (log: $OUT/api.log)"
  nohup pnpm --filter @ooc/api dev >"$OUT/api.log" 2>&1 &
  wait_for "$API/health" 90 API "$OUT/api.log"
fi

if up "$APP"; then
  echo "→ App already running"
else
  echo "→ Starting the app (log: $OUT/app.log)"
  nohup pnpm --filter @ooc/app dev >"$OUT/app.log" 2>&1 &
  wait_for "$APP" 120 App "$OUT/app.log"
fi

echo "→ Preview account ($ROLE)"
ACCOUNT="$(PREVIEW_ROLE="$ROLE" pnpm --filter @ooc/api -s seed:preview 2>"$OUT/seed.log" | tail -1)" \
  || { echo "✗ seed failed — see $OUT/seed.log" >&2; exit 1; }
EMAIL="$(node -e 'console.log(JSON.parse(process.argv[1]).email)' "$ACCOUNT")"
PASSWORD="$(node -e 'console.log(JSON.parse(process.argv[1]).password)' "$ACCOUNT")"

echo "→ Signing in as $EMAIL"
rm -f "$OUT/cookies.txt"
STATUS="$(curl -s -o "$OUT/sign-in.json" -w '%{http_code}' -c "$OUT/cookies.txt" \
  -H 'Content-Type: application/json' -H "Origin: $APP" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" \
  "$APP/api/auth/sign-in/email")"
[ "$STATUS" = 200 ] || { echo "✗ sign-in answered $STATUS — see $OUT/sign-in.json" >&2; exit 1; }

# curl's cookie jar → Playwright storage state.
node - "$OUT/cookies.txt" "$OUT/state.json" <<'EOF'
const fs = require("node:fs");
const [jar, out] = process.argv.slice(2);
const cookies = fs.readFileSync(jar, "utf8").split("\n").flatMap((line) => {
  const httpOnly = line.startsWith("#HttpOnly_");
  if (!line.trim() || (line.startsWith("#") && !httpOnly)) return [];
  const [domain, , path, secure, expires, name, value] = line.replace("#HttpOnly_", "").split("\t");
  return [{ name, value, domain, path, expires: Number(expires) || -1, httpOnly, secure: secure === "TRUE", sameSite: "Lax" }];
});
if (cookies.length === 0) throw new Error("sign-in set no cookie");
fs.writeFileSync(out, JSON.stringify({ cookies, origins: [] }));
EOF

echo "→ Opening $APP$LAND"
nohup npx -y "$PLAYWRIGHT" open --load-storage="$OUT/state.json" "$APP$LAND" >"$OUT/browser.log" 2>&1 &
echo "✓ Browser opening as $EMAIL / $PASSWORD ($ROLE)"
