# atelier-builder

## Adding a check or a how-to page

- **A check** is one new file in `scripts/` whose first line (after any `#!`) names the runs it belongs to:
  `// @checks build guard` (either or both). `npm run build` and `npm run guard` run every file marked for them in
  file-name order (`node scripts/run-checks.mjs guard --list` shows them) and stop at the first failure. Never add
  it to a chain in package.json.
- **A how-to page** lives in wsg-dashboard, one file per page: see `wsg-dashboard/CLAUDE.md`.
