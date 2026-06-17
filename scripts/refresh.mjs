// Regulation Radar — daily refresh
// Fetches each monitored source via Jina Reader (r.jina.ai), diffs against the
// previous snapshot, and writes public/data/changes.json + per-source snapshots.
//
// Usage: node scripts/refresh.mjs
// Optional env:
//   JINA_API_KEY  - Bearer token for r.jina.ai (raises rate limits; not required)

import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { constants as FS } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const SOURCES_FILE = resolve(ROOT, "data", "sources.json");
const SNAPSHOT_DIR = resolve(ROOT, "data", "snapshots");
const OUT_FILE = resolve(ROOT, "public", "data", "changes.json");

const FETCH_TIMEOUT_MS = 30_000;
const POLITE_DELAY_MS = 1_200;
const MAX_CHANGES = 100;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (s) => createHash("sha256").update(s).digest("hex");

async function ensureDir(dir) {
  await mkdir(dir, { recursive: true });
}

async function readIfExists(path) {
  try {
    await access(path, FS.F_OK);
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

async function fetchViaJina(url) {
  const target = `https://r.jina.ai/${url}`;
  const headers = { Accept: "text/plain" };
  if (process.env.JINA_API_KEY) {
    headers.Authorization = `Bearer ${process.env.JINA_API_KEY}`;
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(target, { headers, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    if (!text || !text.trim()) throw new Error("empty response");
    return text;
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const raw = await readFile(SOURCES_FILE, "utf8");
  const { sources } = JSON.parse(raw);
  const keys = Object.keys(sources);

  await ensureDir(SNAPSHOT_DIR);
  await ensureDir(dirname(OUT_FILE));

  // Load existing output to preserve the rolling changes list.
  let prevOut = { meta: {}, sources: [], changes: [] };
  const prevOutRaw = await readIfExists(OUT_FILE);
  if (prevOutRaw) {
    try {
      prevOut = JSON.parse(prevOutRaw);
    } catch {
      /* corrupt file — start fresh */
    }
  }
  const existingChanges = Array.isArray(prevOut.changes) ? prevOut.changes : [];

  const sourceResults = [];
  const newChanges = [];

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const meta = sources[key];
    const snapPath = resolve(SNAPSHOT_DIR, `${key}.txt`);
    const now = new Date().toISOString();

    const prevSnap = await readIfExists(snapPath);
    const prevHash = prevSnap == null ? null : sha(prevSnap);

    let status, chars, delta;

    try {
      const text = await fetchViaJina(meta.url);
      const newHash = sha(text);
      chars = text.length;

      if (prevSnap == null) {
        // First scan — establish baseline, do not emit a "change".
        status = "unchanged";
        delta = 0;
        await writeFile(snapPath, text, "utf8");
      } else if (newHash !== prevHash) {
        status = "changed";
        delta = text.length - prevSnap.length;
        await writeFile(snapPath, text, "utf8");
        newChanges.push({
          date: now,
          region: meta.region,
          authority: meta.authority,
          url: meta.url,
          note: `Change detected (Δ ${delta >= 0 ? "+" : ""}${delta} chars)`,
        });
      } else {
        status = "unchanged";
        delta = 0;
        // snapshot unchanged; no rewrite needed
      }
    } catch (err) {
      // Keep the old snapshot on failure.
      status = "error";
      chars = prevSnap == null ? 0 : prevSnap.length;
      delta = 0;
      console.error(`[${key}] fetch failed: ${err.message}`);
    }

    sourceResults.push({
      key,
      name: meta.name,
      authority: meta.authority,
      region: meta.region,
      url: meta.url,
      lastChecked: now,
      status,
      chars,
      delta,
    });

    console.log(`[${key}] ${status} (${chars} chars, Δ ${delta})`);

    if (i < keys.length - 1) await sleep(POLITE_DELAY_MS);
  }

  // Prepend new changes, cap to the latest MAX_CHANGES.
  const mergedChanges = [...newChanges, ...existingChanges].slice(0, MAX_CHANGES);

  const out = {
    meta: {
      lastRun: new Date().toISOString(),
      sourcesMonitored: keys.length,
    },
    sources: sourceResults,
    changes: mergedChanges,
  };

  await writeFile(OUT_FILE, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(
    `\nDone. ${keys.length} sources, ${newChanges.length} new change(s), ${mergedChanges.length} in feed.`
  );
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
