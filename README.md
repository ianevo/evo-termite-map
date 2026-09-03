# Termite Territory Map

Interactive zip-code map of preventative termite penetration, the calling funnel, and
inspection progress — one page, toggled between the **Wichita**, **St. Louis**, and
**Little Rock** territories. Built from RevHawk / FieldRoutes data per office, plus
(where a campaign has started) the team's zip tracking sheet.

**Live map:** https://ianevo.github.io/evo-termite-map/

`index.html` is fully self-contained — Leaflet, boundaries, and all three territories'
data are inlined. It works opened directly from disk, with no server and no network.

## Three territories, one page

A pill toggle at the top switches the whole page — map, KPIs, sidebar, footer — between
territories:

- **Wichita** (Kansas office) — the mature campaign. Termite plans are selling, the
  calling funnel is loaded from the tracking sheet, and campaign status is meaningful.
- **St. Louis** (St. Louis office) — pre-launch, zero termite plans sold. No calling
  campaign loaded either, so every zip reads "not in campaign" / 0% penetration. This is
  expected, not a bug: the map exists purely to show where the existing customer book is
  concentrated, so appointment-setting can start with the densest zips first instead of a
  scattered route.
- **Little Rock** (Little Rock office) — also pre-launch (no calling campaign loaded
  yet), but unlike St. Louis this office already has a handful of legacy termite plans
  (12, scattered) predating any organized push. That's enough local signal for a real
  average plan value, so its opportunity math is self-computed rather than borrowed. This
  office covers a much wider area than the other two — Little Rock/North Little Rock,
  Conway, Cabot, Benton/Bryant, Hot Springs, Searcy, Pine Bluff, Russellville, Heber
  Springs, and a long tail of small towns around them — because that's the real shape of
  the office's book, not a tighter single-metro area like Wichita or St. Louis.

For any pre-launch territory, its "Opportunity" ranking is effectively an
active-customer-density ranking until real termite/funnel data exists.

Six map views, same for all three territories:

| View | Encodes |
|---|---|
| Campaign status | How far through the call list each zip is |
| Calling progress | % of loaded leads actually called |
| Termite penetration | Active termite plans ÷ active customers |
| Opportunity ($ ARV) | Annual value of the plans still needed to hit 30% |
| Active customers | Book size per zip |
| Call order | Suggested order to work every zip, most efficient routing |

**Call order** answers "which zip do we drive to next": it's the shortest total path
(nearest-neighbor + 2-opt over straight-line distance between zip centroids) visiting
every zip in the territory exactly once, starting at the biggest-opportunity zip. Selecting
it draws the route as a dashed line on the map, shades zips from light (first stop) to
dark (last), and swaps the usual zip-code labels for numbered markers showing each zip's
position in the route. The sidebar's **Call order** tab lists the same sequence with the
running mileage. It ignores campaign status by design — it's a driving/dialing sequence,
not a priority filter — so cross-check the status pill next to each zip before skipping one
that's already complete. For a spread-out territory like Little Rock, this is the
difference between a several-hundred-mile zig-zag and a sane loop through the region.

Click any zip for a full profile: penetration against the 30% goal, the complete calling
funnel (if any), opportunity, customer base, and inspection history. The sidebar toggles
between **Opportunity** (where the money is) and **Call queue** (what's blocking the next
round of inspections).

Zips where inspections are landing but plans aren't selling get an explicit callout in
the panel — 8+ inspections shown with under 15% penetration.

## Two data sources, two different questions

- **RevHawk / FieldRoutes** — the customer book, active termite plans, and logged
  inspection appointments. This is the system of record for what was sold and serviced.
- **The tracking sheet** — the calling funnel: leads loaded, called, scheduled, showed
  up, not interested, left to call. This is upstream of RevHawk and is the only place
  that knows which zips are actively being worked. St. Louis and Little Rock have no
  sheet data yet — their campaign status is entirely "not in campaign" until leads get
  loaded.

For Wichita, the two reconcile closely: as of September 2, the sheet reported 155 leads
shown up against RevHawk's 158 customers inspected this year. Campaign status is driven
off the sheet, because a zip can have leads loaded and zero appointments yet.

## Definitions

- **Penetration** — active termite subscriptions ÷ active customers, per zip.
- **Termite plan** — any subscription whose service type contains "termite," excluding
  `Termite Inspection` (that's the appointment, not the plan) and `TEST Termite`, with
  `active='1'` and `dateCancelled='0000-00-00 00:00:00'`. In Wichita the current product
  is **24 Termite KS**; legacy products are `Termite OUTDATED` and `12 Month Termite`.
  St. Louis has no termite product yet; Little Rock has a small number of legacy plans
  but no organized campaign.
- **Inspection window** — the current calendar year only. Inspections run annually for
  every customer, so prior-year work is a separate cycle and is excluded.
- **Opportunity ARV** — values each additional plan at the market's live average termite
  plan ARV, recomputed on every build. A territory with *zero* termite plans (St. Louis)
  has no local average to compute, so it borrows Wichita's instead — the one mature,
  fully-launched market — clearly labeled as such in the page footer. A territory with
  *some* local plans, even a small legacy handful (Little Rock), computes its own average
  rather than borrowing one.

### Campaign status thresholds

| Status | Rule |
|---|---|
| Complete | 80%+ of loaded leads called |
| In progress | 15%+ called |
| Queued to call | Leads loaded, calling not started |
| Paused | Pulled from the dialer on purpose (`"paused": true` in `funnel.json`) — leads held, to be reworked separately |
| Not in campaign | No leads loaded for this zip |

Pausing a zip keeps its lead history (so nothing is lost) but takes it out of the normal
call-rate math and off the route plan — set `"paused": true` on its entry in
`funnel.json` rather than deleting the entry.

## Refreshing the data

Each territory has its own scheduled task (see "Automated refresh" below) that pulls
RevHawk, rebuilds, and pushes daily — Wichita's also pulls the tracking sheet. To do a
refresh by hand instead:

1. Run `pipeline/<territory>/query.sql` through RevHawk (`run_query`).
2. Save the returned rows to `pipeline/<territory>/rows.json` (either a bare JSON list
   or the full `{"rows": [...]}` response — both work).
3. Wichita only: update `pipeline/wichita/funnel.json` from the tracking sheet's per-zip
   summary table — one entry per zip with `total_leads`, `scheduled`, `showed_up`,
   `left_to_call`, `not_interested`. Only zips actually in the calling campaign belong
   here. (St. Louis and Little Rock have no `funnel.json` yet — add one the same way once
   each campaign starts.)
4. `node pipeline/build.mjs` → regenerates `index.html` for **all three** territories in
   one pass.
5. Commit and push. GitHub Pages redeploys automatically.

The build prints headline totals per territory so you can sanity-check each run:

```
[wichita] 41 zips — active 2,598 | termite 64 | penetration 2.5% | gap to 30% 737 plans ($369,237) | avg plan ARV $501
[wichita] funnel: 899 leads | 252 called (28%) | 155 showed up | 647 left to call
[stlouis] 39 zips — active 863 | termite 0 | penetration 0.0% | gap to 30% 276 plans ($138,276) | avg plan ARV $501
[littlerock] 61 zips — active 2,566 | termite 12 | penetration 0.5% | gap to 30% 783 plans ($366,444) | avg plan ARV $468
```

It also warns if a zip has metrics but no boundary polygon, or funnel data with no
matching zip — both mean a new zip needs adding to that territory's `query.sql` and
`boundaries.geojson`.

**The build requires Node.js** (`node pipeline/build.mjs`), not Python — there's no
`build.py` any more. Node was what was actually available when this pipeline was ported
to support multiple territories; nothing in the pipeline needs Python specifically.

## Repo layout

```
index.html                        the map — what Pages serves (all territories inlined)
pipeline/
  build.mjs                       rows + funnel + boundaries -> index.html, all territories
  template.html                   page shell, shared by every territory
  leaflet.js / leaflet.css        inlined into the output
  wichita/
    query.sql                     RevHawk query, one row per zip
    rows.json                     latest query results
    funnel.json                   calling funnel from the tracking sheet
    boundaries.geojson            ZCTA polygons, geometry only
  stlouis/
    query.sql                     RevHawk query, one row per zip
    rows.json                     latest query results
    boundaries.geojson            ZCTA polygons, geometry only (no funnel.json yet)
  littlerock/
    query.sql                     RevHawk query, one row per zip
    rows.json                     latest query results
    boundaries.geojson            ZCTA polygons, geometry only (no funnel.json yet)
routeplan/                        Wichita-only driving-route planner (separate page, unrelated toggle)
```

## Adding a new zip to a territory's campaign

1. Add the zip to that territory's `pipeline/<territory>/query.sql` scope (Wichita and
   Little Rock use a `zip IN (...)` / range filter; St. Louis uses a `county IN (...)`
   whitelist — match whichever style that territory already uses).
2. Add its ZCTA polygon to `pipeline/<territory>/boundaries.geojson`.
3. Add its funnel row to `pipeline/<territory>/funnel.json`, if that territory has one.

Zips with fewer than 5 all-time accounts are dropped **unless** they appear in
`funnel.json` — so small campaign zips still render once they're being worked.

## Boundary data

Every territory's `boundaries.geojson` was pulled fresh from the Census Bureau's
TIGERweb ZCTA layer (`tigerWMS_Census2020`, layer 84) and simplified with Douglas-Peucker
to keep file size reasonable:

| Territory | Zips | Simplification ε | Full-res → simplified |
|---|---|---|---|
| St. Louis | 39 | 0.0012° | ~1.7 MB → ~100 KB |
| Little Rock | 61 | 0.0025° (coarser — the territory spans ~150 miles, so fine detail matters less) | ~5.3 MB → ~190 KB |

Wichita's `boundaries.geojson` predates both and was generalized by whatever process the
original Cowork session used.

## Automated refresh

Each territory has its own scheduled task (Claude Code's local scheduler, not a GitHub
Action — see below for why) that runs daily:

| Task | Time | What it does |
|---|---|---|
| `wichita-termite-map-refresh` | 6:10 AM | RevHawk query + reads the tracking sheet (preserving any manual `"paused"` flags) → rebuild → push |
| `stlouis-termite-map-refresh` | 6:19 AM | RevHawk query only (no campaign sheet yet) → rebuild → push |
| `littlerock-termite-map-refresh` | 6:28 AM | RevHawk query only (no campaign sheet yet) → rebuild → push |

Staggered ~9 minutes apart, and each does a `git pull --ff-only` before rebuilding so they
can't clobber each other if a run ever overlaps. Each skips the commit entirely if nothing
actually changed since the last run — no daily no-op noise in the git history.

These run as **scheduled Claude Code tasks**, not a plain GitHub Actions cron job, because
they reuse this session's existing RevHawk and Google Drive/Sheets connectors directly —
a GitHub Actions runner has no Claude/MCP integration at all and would need its own
separate, portable API credentials wired up as repo secrets. Since the connectors already
work here, that's unnecessary complexity for no benefit.

## Notes

- Boundaries are US Census ZCTA polygons, which approximate but don't exactly match
  USPS delivery zips.
- Rural/exurban zips are geographically large and visually dominate the map despite
  modest customer counts — read the panel, not the area. Notably: El Dorado (67042) in
  Wichita; Wentzville (63385), Eureka (63025) in St. Louis; Hot Springs (71913), Heber
  Springs (72543), Russellville (72801/72802) in Little Rock.
- The close-rate callout is directional: a few termite plans predate the Wichita
  campaign, so plans ÷ inspections shown slightly overstates conversion. Not applicable
  to St. Louis (zero plans sold) or Little Rock (no campaign, though a few legacy plans
  exist).
- **This site is public.** GitHub Pages serves publicly regardless of repo visibility.
  Anyone with the link can see zip-level customer counts and revenue, for all three
  territories.
