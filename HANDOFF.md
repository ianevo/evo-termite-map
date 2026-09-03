# Handoff notes

> **Update, September 3, 2026:** everything in "What's still open" below is done —
> the repo is live at [github.com/ianevo/evo-termite-map](https://github.com/ianevo/evo-termite-map)
> and served at https://ianevo.github.io/evo-termite-map/. The map now also covers a
> second territory (St. Louis, pre-launch) behind a toggle, and the build pipeline was
> ported from `pipeline/build.py` (Python) to `pipeline/build.mjs` (Node.js) — Python
> wasn't available on the machine this work continued on. **README.md reflects the
> current state; the rest of this file is the original Cowork handoff, kept as-is for
> history.**

This folder was built by Claude in Cowork (a cloud session) and dropped here so your
local Claude Code can take it from here. Everything needed to run and refresh the map
is included — see `README.md` for the full picture. Quick orientation:

- `index.html` — the live map, self-contained (Leaflet + data inlined). Open it directly
  in a browser, no server needed.
- `artifact.html` — same content, stripped down for Claude's Artifact publisher (no
  doctype/html/head/body wrapper). Not needed for GitHub Pages — that serves `index.html`.
- `pipeline/` — the build: `query.sql` (RevHawk), `rows.json` + `funnel.json` (latest
  pulled data), `build.py` (regenerates `index.html`), `template.html` (page shell).
- `routeplan/` — a second, related page: `route_plan.html` is a map of the zips not yet
  in the calling campaign, ordered for an efficient inspection route. `build_route.py`
  regenerates it from `route_full.json`.

## What's still open

This project was never pushed to GitHub — it only existed in the cloud session. Ian
wants it on GitHub so:
1. The map has a stable public URL (GitHub Pages), not dependent on Claude Artifact
   sharing settings (which have been flaky for a teammate, Mika).
2. It can refresh automatically instead of needing a manual rebuild each time.

Suggested next steps, from here:

1. `git init`, commit everything in this folder.
2. Create a GitHub repo (e.g. `evo-termite-map`) and push. `public` is fine — GitHub
   Pages serves publicly regardless of repo visibility either way, and Ian has already
   accepted that (zip-level customer counts/revenue are visible to anyone with the link).
3. Enable GitHub Pages on the repo, serving `index.html` from the root of the default
   branch (or `/docs` if you'd rather move it there — update the workflow/settings to
   match).
4. To automate refreshes: a scheduled GitHub Action (or similar) that re-runs
   `pipeline/query.sql` through RevHawk, updates `pipeline/rows.json`, pulls the latest
   numbers from the team's tracking sheet into `pipeline/funnel.json`
   (https://docs.google.com/spreadsheets/d/15Pms0pqCpv0HqguaFjQueQHJ47JvWuxBiqD0f7HlP30),
   runs `python3 pipeline/build.py`, and commits/pushes the regenerated `index.html`.
   RevHawk access and Google Sheets read access both need credentials set up wherever
   that job runs — the cloud session didn't have a way to grant either from here.

None of that setup was possible from the Cowork cloud session itself — no GitHub
connector is attached there, and this session's only reliable way to move a 41-zip,
~270KB self-contained file back to Ian was to publish it as a private Claude Artifact
(the current live link) or hand it over exactly like this.
