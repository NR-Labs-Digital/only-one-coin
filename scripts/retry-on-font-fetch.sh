#!/usr/bin/env bash
# Runs a command and retries it only when it failed because `next/font/google`
# could not fetch a font from Google Fonts at build time — a network hiccup on
# Google's side, not a code error. Any other failure exits at once with the
# command's own status, so a genuinely broken build is never run three times.
#
#   scripts/retry-on-font-fetch.sh pnpm -r build
#
# FONT_RETRY_ATTEMPTS (default 3) and FONT_RETRY_DELAY_SECONDS (default 20,
# doubled each round) tune it.
set -uo pipefail

if [ "$#" -eq 0 ]; then
  echo "usage: $0 <command> [args...]" >&2
  exit 64
fi

attempts="${FONT_RETRY_ATTEMPTS:-3}"
delay="${FONT_RETRY_DELAY_SECONDS:-20}"
log="$(mktemp)"
trap 'rm -f "$log"' EXIT

# What Next prints when the font fetch is the failure: the generic wrapper
# line, plus the fetch errors it reports underneath it.
pattern='An error occurred in `next/font`|Failed to fetch font|Failed to fetch `[^`]+` from Google Fonts'

for attempt in $(seq 1 "$attempts"); do
  "$@" 2>&1 | tee "$log"
  status="${PIPESTATUS[0]}"
  [ "$status" -eq 0 ] && exit 0

  if ! grep -qE "$pattern" "$log"; then
    exit "$status"
  fi

  if [ "$attempt" -lt "$attempts" ]; then
    echo "::warning::next/font could not reach Google Fonts (attempt $attempt/$attempts) — retrying in ${delay}s"
    sleep "$delay"
    delay=$((delay * 2))
  fi
done

echo "::error::next/font could not reach Google Fonts after $attempts attempts"
exit "$status"
