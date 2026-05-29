#!/usr/bin/env bash
# One-shot: link the GitHub repo to the Vercel project + set production branch.
# Run AFTER installing the Vercel GitHub App on karlryan-a11y/atelier-builder
#   → https://github.com/apps/vercel
set -euo pipefail

PROJECT_ID="prj_myJjUDCtBU70DajBFi6sB1cb8qxP"
TEAM_ID="team_7qhkvdiUYPjNNS7jZbwSMR7p"
REPO="karlryan-a11y/atelier-builder"
AUTH="$HOME/Library/Application Support/com.vercel.cli/auth.json"

TOKEN="$(python3 -c "import json; print(json.load(open('$AUTH'))['token'])")"

echo "Linking $REPO to project $PROJECT_ID ..."
RESP="$(curl -s -X POST \
  "https://api.vercel.com/v10/projects/${PROJECT_ID}/link?teamId=${TEAM_ID}" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"type\":\"github\",\"repo\":\"${REPO}\"}")"

echo "$RESP" | python3 -m json.tool

# Bail if the API still reports the GitHub App is missing.
if echo "$RESP" | grep -q '"error"'; then
  echo ""
  echo "Link failed — install the Vercel GitHub App first: https://github.com/apps/vercel"
  exit 1
fi

echo ""
echo "Setting production branch to main ..."
curl -s -X PATCH \
  "https://api.vercel.com/v9/projects/${PROJECT_ID}?teamId=${TEAM_ID}" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"link":{"productionBranch":"main"}}' \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print('productionBranch:', (d.get('link') or {}).get('productionBranch'))"

echo ""
echo "Done. Pushes to main now auto-deploy."
