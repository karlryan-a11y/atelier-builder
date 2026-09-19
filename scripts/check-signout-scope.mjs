#!/usr/bin/env node
// Every Supabase signOut() must be scope 'local'.
//
// supabase-js signOut() defaults to scope 'global': it ends EVERY session the person has, on every
// device. Signing out on a phone signed the iPad out too. Local scope ends only this device's session.
// This guard finds every `.signOut(` call in the source and fails on any whose arguments do not say
// scope: 'local'. It reports how many files and calls it inspected and fails at zero (HARD-RULES).

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = process.argv[2] ? resolve(process.argv[2]) : join(dirname(fileURLToPath(import.meta.url)), "..");
const DIRS = ["src", "api"];

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|jsx?|mjs|cjs|astro)$/.test(name)) out.push(p);
  }
  return out;
}

// Arguments of a call starting at the "(" index, respecting nesting.
function argsAt(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")" && --depth === 0) return src.slice(open + 1, i);
  }
  return src.slice(open + 1);
}

const files = DIRS.flatMap((d) => walk(join(root, d)));
let calls = 0;
const bad = [];
for (const f of files) {
  const src = readFileSync(f, "utf8");
  const re = /\.signOut\s*\(/g;
  let m;
  while ((m = re.exec(src))) {
    calls++;
    const args = argsAt(src, m.index + m[0].length - 1);
    if (!/scope\s*:\s*["'`]local["'`]/.test(args)) {
      const line = src.slice(0, m.index).split("\n").length;
      bad.push(`${relative(root, f)}:${line}  signOut(${args.trim()})`);
    }
  }
}
console.log(`check-signout-scope: inspected ${files.length} files, ${calls} signOut() call(s), ${bad.length} without scope 'local'`);
for (const b of bad) console.error(`  FAIL ${b}`);
if (files.length === 0 || calls === 0) {
  console.error("check-signout-scope: FAIL measured nothing (0 files or 0 calls)");
  process.exit(1);
}
process.exit(bad.length ? 1 : 0);
