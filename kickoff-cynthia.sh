#!/usr/bin/env bash
# Kickoff for the Cynthia styling-parity build on the STAGING stack.
# Safe prep only — branches without losing WIP, points the app at staging,
# then launches a caffeinated, dangerous-permissions Claude Code session
# pointed at ATELIER_CYNTHIA_BUILD.md.
set -euo pipefail
cd "$(dirname "$0")"

echo "==> 1/4  Branching off main without clobbering WIP"
git stash push -u -m "cynthia-build-autostash" >/dev/null 2>&1 && STASHED=1 || STASHED=0
git checkout -B feature/cynthia-styling
if [ "$STASHED" = "1" ]; then
  git stash pop || { echo "!! stash pop conflicted — resolve manually, WIP is in 'git stash list'"; exit 1; }
fi

echo "==> 2/4  Pointing .env.local at STAGING Supabase"
[ -f .env.staging.local ] || { echo "!! .env.staging.local missing — re-run prep"; exit 1; }
[ -f .env.local.live.bak ] || cp .env.local .env.local.live.bak
cp .env.staging.local .env.local
grep -q "yuoxmcuj" .env.local || { echo "!! .env.local is NOT pointing at staging — aborting"; exit 1; }
echo "    staging confirmed (yuoxmcuj...)"

echo "==> 3/4  Installing deps"
npm install --silent

echo "==> 4/4  Launching caffeinated Claude Code (dangerous permissions)"
echo "    Live env backed up at .env.local.live.bak"
echo "    Branch: feature/cynthia-styling"
echo
caffeinate -dimsu claude --dangerously-skip-permissions \
  "Read ATELIER_CYNTHIA_BUILD.md in full first — it is the master brief and defines two workstreams plus the hard guardrails. Execute the entire build on the STAGING stack only, honoring every guardrail. WORKSTREAM 1 (this file): finish Groups A, B, C and the §4 fix completely, verifying each feature in the browser preview before moving on. THEN WORKSTREAM 2: read ATELIER_CHAT_BUILD.md and build the client↔stylist chat per its §0 integration notes — build everything that needs no external secret, and NEVER message a real client during the staging build; batch any credential needs (Slack/Resend/test destinations) into the final report. Keep BUILD_LOG.md current throughout. When finished, write CYNTHIA_BUILD_REPORT.md (covering both workstreams + the consolidated list of secrets Karl must supply) and stop without deploying to or touching live."
