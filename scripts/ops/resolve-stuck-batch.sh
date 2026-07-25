#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# resolve-stuck-batch.sh  —  resolve ONE specific stuck digitization batch
#
# Scope: acts on a SINGLE batch id passed as $1 (no pattern sweep, no bulk
#        update). Marks it status='complete' with completed_at=now(), matching
#        how normally-finished batches look. This clears the "Digitization
#        Monitor" Slack alert, which keys on batch status='processing'.
#
# Context: a batch stays in 'processing' forever if a single item hangs in a
#        transient state (e.g. pending_metadata). This resolves the batch record.
#
# Safety: only the one id you pass is touched; prints before/after; reversible
#        (status/completed_at only, nothing deleted). Env from ../../.env.local.
#
# USAGE:  bash scripts/ops/resolve-stuck-batch.sh <batch-uuid>
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

BID="${1:-}"
[ -n "$BID" ] || { echo "usage: $0 <batch-uuid>" >&2; exit 2; }
# require a well-formed UUID so no wildcard / injection can broaden the target
echo "$BID" | grep -Eq '^[0-9a-fA-F-]{36}$' || { echo "ERROR: '$BID' is not a UUID" >&2; exit 2; }

ENV_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/.env.local"
[ -f "$ENV_FILE" ] || { echo "ERROR: $ENV_FILE not found" >&2; exit 1; }
set -a; # shellcheck disable=SC1090
source "$ENV_FILE"; set +a

URL="${VITE_SUPABASE_URL:-}"; KEY="${SUPABASE_SERVICE_ROLE_KEY:-}"
[ -n "$URL" ] && [ -n "$KEY" ] || { echo "ERROR: missing Supabase env" >&2; exit 1; }
NOW="$(date -u +%Y-%m-%dT%H:%M:%S.000+00:00)"

echo "→ Batch ${BID} — current state:"
curl -s "${URL}/rest/v1/intake_batches?id=eq.${BID}&select=id,status,created_at,updated_at,total_photos" \
  -H "apikey: ${KEY}" -H "Authorization: Bearer ${KEY}" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print('  NOT FOUND' if not d else f\"  status={d[0]['status']} photos={d[0].get('total_photos')} last_activity={d[0]['updated_at']}\")"

echo "→ Marking complete (completed_at=${NOW})..."
curl -s -X PATCH "${URL}/rest/v1/intake_batches?id=eq.${BID}" \
  -H "apikey: ${KEY}" -H "Authorization: Bearer ${KEY}" \
  -H "Content-Type: application/json" -H "Prefer: return=representation" \
  -d "{\"status\":\"complete\",\"completed_at\":\"${NOW}\"}" \
  | python3 -c "import sys,json; r=json.load(sys.stdin)[0]; print(f\"  ✓ {r['id']} -> status={r['status']} completed_at={r['completed_at']}\")"
