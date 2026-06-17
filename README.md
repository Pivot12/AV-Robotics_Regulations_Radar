# AV & Robotics Standards Radar

> Know the moment a rule or safety standard changes across autonomous vehicles and robotics.

AV & Robotics Standards Radar is a pure-static dashboard that watches the
official regulators and standards bodies governing autonomous vehicles and
robotics, and surfaces detected changes in a live feed. It is
**self-maintaining**: a daily GitHub Action fetches each source, diffs it
against the previous snapshot, and commits an updated
`public/data/changes.json` that the page reads on load.

## Categories monitored

Sources are grouped into five domains:

1. **Autonomous Vehicles** — UNECE WP.29 GRVA, NHTSA Automated Vehicles, NHTSA
   Standing General Order (AV crash reporting), California DMV AV, California
   CPUC AV programs.
2. **Robotics & Machinery Safety** — ISO/TC 299 Robotics (ISO 10218, 15066,
   13482), A3 / RIA robot safety standards (R15.06), OSHA Robotics, EU Machinery
   Regulation 2023/1230.
3. **Functional Safety** — ISO/TC 22 Road vehicles (ISO 26262, 21448 SOTIF,
   22737), IEC Functional Safety (IEC 61508).
4. **AI Governance** — EU AI Act, NIST AI Risk Management Framework.
5. **Drones / UAS** — FAA UAS / Drones.

## How it works

1. `data/sources.json` lists the authorities to monitor, each with a `name`,
   `authority`, `region` (used as the category) and `url`. The `regions` array
   lists the five categories above.
2. `scripts/refresh.mjs` fetches each source through the free
   [Jina Reader](https://jina.ai/reader/) (`https://r.jina.ai/<url>`), which
   returns clean text for any page. It hashes the text, compares it to the
   previous snapshot in `data/snapshots/<KEY>.txt`, and:
   - marks **changed** (records a feed entry with the char delta) when the hash
     differs,
   - marks **unchanged** when identical,
   - marks **error** (keeps the old snapshot) on fetch failure.
   The first scan of any source establishes a baseline and is **not** reported as
   a change. Sources are fetched politely (~1.2s apart). The script is
   source-agnostic — adding or removing entries in `sources.json` requires no
   code change.
3. The script writes `public/data/changes.json` (rolling feed, capped to the
   latest 100 changes) and the new snapshots.
4. `index.html` fetches `public/data/changes.json` on load and renders the feed,
   the monitored-sources panel, category coverage, category filters, source
   search, and the email-digest signup form.

## Project layout

```
regulation-radar/
├── public/
│   ├── index.html          # the radar dashboard / feed
│   ├── privacy.html
│   └── data/
│       └── changes.json    # written by the Action; read by the page
├── data/
│   ├── sources.json        # authorities / standards bodies to monitor
│   └── snapshots/          # per-source text snapshots (committed by the Action)
├── scripts/
│   └── refresh.mjs         # fetch + diff + write
├── .github/workflows/
│   └── refresh.yml         # daily cron + manual dispatch
├── package.json
├── .gitignore
└── README.md
```

## Deploy on Vercel (static)

1. **Push to GitHub.** Create a repo and push this folder.
2. **Import to Vercel.** New Project → import the repo.
   - **Framework Preset: Other**
   - **Build Command:** leave empty
   - **Output Directory:** `public`
   - (No serverless functions are needed — this is pure static.)
3. **Deploy.** Vercel serves `public/index.html` at the root.

## Enable the self-maintaining Action

1. In the GitHub repo: **Settings → Actions → General → Workflow permissions** →
   select **Read and write permissions** (lets the Action commit updated data).
2. (Optional) Add a repo secret **`JINA_API_KEY`** under
   **Settings → Secrets and variables → Actions** to raise Jina Reader rate
   limits. Not required — the reader works without a key.
3. Go to the **Actions** tab → **Refresh** workflow → **Run workflow** once to
   establish the first baseline snapshots. After that it runs daily at 08:00 UTC,
   and you can trigger it manually any time via **Run workflow**.

Each run commits `public/data/changes.json` and `data/snapshots/`. Vercel
redeploys automatically on the new commit, so the live page always reflects the
latest scan.

## Run locally

```bash
npm run refresh
```

This requires Node 20+. It will populate `data/snapshots/` and rewrite
`public/data/changes.json`. To preview the page, serve `public/` with any static
server (e.g. `npx serve public`).

## Email digests (later)

The signup form collects subscribers via the shared webhook contract (emails the
operator). A subscriber-facing email digest — sending each run's summary to the
list — can be added later by POSTing a digest to a mailing service from
`refresh.mjs` (guarded behind a `WEBHOOK_URL` env var). Skipped in v1 to keep the
deploy purely static.

## Configure the contact webhook

`index.html` and `privacy.html` share a single contract. Set `WEBHOOK_URL` in
`index.html` to your Apps Script (or other) endpoint URL. Until it is set
(`REPLACE_WITH_APPS_SCRIPT_URL`), form submissions are no-ops but still show the
optimistic success state.

## Notes & caveats

- **Jina Reader normalizes pages to text.** Char deltas reflect content changes,
  but dynamic/rotating page elements (timestamps, "related" widgets) can produce
  small deltas that are not substantive regulatory or standards changes. Treat the
  feed as a *signal to investigate*, not a legal record.
- Some standards bodies (ISO, IEC) gate the full text of standards behind
  paywalls; the radar monitors the public committee/landing pages, which still
  announce new editions, amendments, and revisions.
- Sources behind aggressive bot protection may intermittently return `error`;
  the previous snapshot is preserved so no false "change" is emitted.
