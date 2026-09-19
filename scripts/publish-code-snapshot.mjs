#!/usr/bin/env node
// Publishes THIS app's source to dashboard.code_snapshot, stamped with the commit being
// deployed. Ask Atelier (atelierbywatson.com/sops) may read nothing else, so what it can
// describe is exactly what is live. Runs as the LAST step of the production build: a build
// that fails publishes nothing, so the snapshot never gets ahead of production.
//
// The same file lives in wsg-dashboard, atelier-builder and wsg-lookbook (ASK-ATELIER-SCOPE.md:
// each repo publishes its own part, because no repo can see the other two). Keep them identical.
//
//   node scripts/publish-code-snapshot.mjs            on Vercel production builds only
//   node scripts/publish-code-snapshot.mjs --force    from a clean checkout of main (seeding)
//
// It never fails the build. A failure prints loudly and the old snapshot stays.
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { execSync } from "node:child_process";

const force = process.argv.includes("--force");
const arg = (name) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : null; };
const ROOT = arg("--root") || process.cwd();

if (process.env.VERCEL_ENV !== "production" && !force) {
  console.log("[code-snapshot] not a production build, skipped");
  process.exit(0);
}

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const repo = arg("--repo") || JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).name;
let sha = arg("--sha") || process.env.VERCEL_GIT_COMMIT_SHA;
if (!sha) { try { sha = execSync("git rev-parse HEAD", { cwd: ROOT }).toString().trim(); } catch { sha = "unknown"; } }

const EXT = /\.(tsx?|jsx?|mjs|astro|svelte|vue)$/;
const SKIP = /(\.test\.|\.spec\.|\.d\.ts$|__tests__|__mocks__|\.stories\.)/;
const SECRET = /(sk-ant-[A-Za-z0-9]|eyJhbGciOi[A-Za-z0-9_-]{20,}|-----BEGIN [A-Z ]*PRIVATE|xox[bp]-[0-9])/;
const MAX_BYTES = 300_000;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (EXT.test(name) && !SKIP.test(p) && st.size <= MAX_BYTES) out.push(p);
  }
  return out;
}

async function rest(method, path, body, prefer) {
  const r = await fetch(`${url}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json",
      "Content-Profile": "dashboard", "Accept-Profile": "dashboard", ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`${method} ${path.split("?")[0]} -> ${r.status} ${(await r.text()).slice(0, 200)}`);
}

try {
  if (!url || !key) throw new Error("no Supabase URL or service role key in this build's environment");
  const files = existsSync(join(ROOT, "src")) ? walk(join(ROOT, "src")) : [];
  for (const extra of ["vercel.json", "next.config.ts", "next.config.mjs", "astro.config.mjs", "vite.config.ts"]) {
    if (existsSync(join(ROOT, extra))) files.push(join(ROOT, extra));
  }
  const rows = [];
  let skippedSecret = 0;
  for (const f of files) {
    // Postgres text cannot hold a NUL; a few source files carry one inside a string literal.
    const content = readFileSync(f, "utf8").replace(/\u0000/g, "");
    if (SECRET.test(content)) { skippedSecret++; console.warn(`[code-snapshot] SKIPPED (looks like a secret): ${relative(ROOT, f)}`); continue; }
    rows.push({ repo, path: relative(ROOT, f).split(sep).join("/"), content, sha, published_at: new Date().toISOString() });
  }
  if (rows.length < 5) throw new Error(`only ${rows.length} files found under ${ROOT}/src, refusing to publish`);

  for (let i = 0; i < rows.length; i += 40) {
    await rest("POST", "code_snapshot?on_conflict=repo,path", rows.slice(i, i + 40), "resolution=merge-duplicates,return=minimal");
  }
  // Files deleted since the last deploy: anything of this repo not stamped with this commit.
  await rest("DELETE", `code_snapshot?repo=eq.${encodeURIComponent(repo)}&sha=neq.${encodeURIComponent(sha)}`, null, "return=minimal");
  // Meta goes last: readers key their cache on it, so it only moves once the files are complete.
  await rest("POST", "code_snapshot_meta?on_conflict=repo", [{ repo, sha, file_count: rows.length, published_at: new Date().toISOString() }], "resolution=merge-duplicates,return=minimal");
  console.log(`[code-snapshot] ${repo} @ ${sha.slice(0, 7)}: ${rows.length} files published${skippedSecret ? `, ${skippedSecret} skipped` : ""}`);
} catch (e) {
  console.error(`\n[code-snapshot] !!! PUBLISH FAILED, Ask Atelier keeps the PREVIOUS snapshot: ${e.message}\n`);
}
process.exit(0);
