#!/usr/bin/env node
// Runs every check in scripts/ marked for one set, in file-name order, and stops at the first failure.
// A check joins a set by a line near its top: `// @checks build` (several sets: `// @checks build guard`).
// So adding a check is adding one file; no shared list in package.json for two requests to edit at once.
//
//   node scripts/run-checks.mjs build          run the "build" set
//   node scripts/run-checks.mjs build --list   print the set's files, run nothing
//
// The same file lives in wsg-dashboard, atelier-builder and atelier-looks. Keep them identical.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const set = process.argv[2];
const listOnly = process.argv.includes("--list");
if (!set || set.startsWith("-")) {
  console.error("usage: node scripts/run-checks.mjs <set> [--list]");
  process.exit(2);
}

const DIR = join(process.cwd(), "scripts");
const MARK = /^\/\/\s*@checks\s+(.+)$/;

function setsOf(file) {
  // The mark sits in the first lines (after a #! line, if any).
  for (const line of readFileSync(join(DIR, file), "utf8").split("\n").slice(0, 5)) {
    const m = MARK.exec(line.trim());
    if (m) return m[1].trim().split(/\s+/);
  }
  return [];
}

const checks = readdirSync(DIR)
  .filter((f) => /\.(mjs|js|cjs)$/.test(f) && f !== "run-checks.mjs")
  .sort()
  .filter((f) => setsOf(f).includes(set));

if (!checks.length) {
  console.error(`[run-checks] no check is marked "// @checks ${set}" in scripts/`);
  process.exit(2);
}

if (listOnly) {
  for (const f of checks) console.log(f);
  process.exit(0);
}

for (const f of checks) {
  const r = spawnSync(process.execPath, [join("scripts", f)], { stdio: "inherit" });
  if (r.status !== 0) {
    console.error(`[run-checks] ${set}: scripts/${f} failed, stopping`);
    process.exit(r.status || 1);
  }
}
