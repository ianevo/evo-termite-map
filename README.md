# Termite Territory Map

Interactive zip-code map of preventative termite penetration, the calling funnel, and
inspection progress — one page, toggled between the **Wichita** and **St. Louis** metros.
Built from RevHawk / FieldRoutes data per office, plus (where a campaign has started)
the team's zip tracking sheet.

**Live map:** https://ianevo.github.io/evo-termite-map/

`index.html` is fully self-contained — Leaflet, boundaries, and both territories' data
are all inlined. It works opened directly from disk, with no server and no network.

## Two territories, one page

A pill toggle at the top switches the whole page — map, KPIs, sidebar, footer — between
territories:

- **Wichita** (Kansas office) — the mature campaign. Termite plans are selling, the
  calling funnel is loaded from the tracking sheet, and campaign status is meaningful.
- **St. Louis** (St. Louis office) — pre-launch. No termite plans have sold yet and no
  calling campaign has been loaded, so every zip reads "not in campaign" / 0% penetration.
  This is expected, not a bug: the St. Louis map exists purely to show where the existing
  customer book is concentrated, so appointment-setting can start with the densest zips
  first instead of a scattered route. Its "Opportunity" ranking is effectively an active-
  customer-density ranking until real termite/funnel data exists.

Six map views, same for both territories:

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
it draws the route as a dashed line on the map and shades zips from light (first stop) to
dark (last). The sidebar's **Call order** tab lists the same sequence with the
running mileage. It ignores campaign status by design — it's a driving/dialing sequence,
not a priority filter — so cross-check the status pill next to each zip before skipping one
that's already complete.

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
  that knows which zips are actively being worked. St. Louis has no sheet data yet — its
  campaign status is entirely "not in campaign" until leads get loaded there.

For Wichita, the two reconcile closely: as of September 2, the sheet reported 155 leads
shown up against RevHawk's 158 customers inspected this year. Campaign status is driven
off the sheet, because a zip can have leads loaded and zero appointments yet.

## Definitions

- **Penetration** — active termite subscriptions ÷ active customers, per zip.
- **Termite plan** — any subscription whose service type contains "termite," excluding
  `Termite Inspection` (that's the appointment, not the plan) and `TEST Termite`, with
  `active='1'` and `dateCancelled='0000-00-00 00:00:00'`. In Wichita the current product
  is **24 Termite KS**; legacy products are `Termite OUTDATED` and `12 Month Termite`.
  St. Louis has no termite product yet.
- **Inspection window** — the current calendar year only. Inspections run annually for
  every customer, so prior-year work is a separate cycle and is excluded.
- **Opportunity ARV** — values each additional plan at the market's live average termite
  plan ARV, recomputed on every build. A territory with no termite plans sold yet (St.
  Louis) has no local average to compute, so it borrows the most comparable *launched*
  territory's average instead — Wichita's, currently ~$501/plan — clearly labeled as such
  in the page footer.

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

Wichita's refresh runs daily as a scheduled Claude task. St. Louis has no scheduled
refresh yet (see "Automating St. Louis" below) — do it by hand for now. Either way:

1. Run `pipeline/<territory>/query.sql` through RevHawk (`run_query`).
2. Save the returned rows to `pipeline/<territory>/rows.json` (either a bare JSON list
   or the full `{"rows": [...]}` response — both work).
3. Wichita only: update `pipeline/wichita/funnel.json` from the tracking sheet's per-zip
   summary table — one entry per zip with `total_leads`, `scheduled`, `showed_up`,
   `left_to_call`, `not_interested`. Only zips flagged `CRM = TRUE` in the sheet belong
   here. (St. Louis has no `funnel.json` yet — add one the same way once its campaign
   starts.)
4. `node pipeline/build.mjs` → regenerates `index.html` for **both** territories in one
   pass.
5. Commit and push. GitHub Pages redeploys automatically.

The build prints headline totals per territory so you can sanity-check each run:

```
[wichita] 41 zips — active 2,589 | termite 64 | penetration 2.5% | gap to 30% 733 plans ($367,233) | avg plan ARV $501
[wichita] funnel: 587 leads | 251 called (43%) | 155 showed up | 336 left to call
[stlouis] 39 zips — active 863 | termite 0 | penetration 0.0% | gap to 30% 276 plans ($138,276) | avg plan ARV $501
```

It also warns if a zip has metrics but no boundary polygon, or funnel data with no
matching zip — both mean a new zip needs adding to that territory's `query.sql` and
`boundaries.geojson`.

**The build requires Node.js** (`node pipeline/build.mjs`), not Python — there's no
`build.py` any more. Node was what was actually available when this pipeline was ported
to support multiple territories; nothing in the pipeline needs Python specifically.

## Repo layout

```
index.html                        the map — what Pages serves (both territories inlined)
pipeline/
  build.mjs                       rows + funnel + boundaries -> index.html, both territories
  template.html                   page shell, shared by both territories
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
routeplan/                        Wichita-only driving-route planner (separate page, unrelated toggle)
```

## Adding a new zip to a territory's campaign

1. Add the zip to the `county IN (...)` / `zip IN (...)` scope in that territory's
   `pipeline/<territory>/query.sql`.
2. Add its ZCTA polygon to `pipeline/<territory>/boundaries.geojson`.
3. Add its funnel row to `pipeline/<territory>/funnel.json`, if that territory has one.

Zips with fewer than 5 all-time accounts are dropped **unless** they appear in
`funnel.json` — so small campaign zips still render once they're being worked.

## St. Louis boundary data

St. Louis's `boundaries.geojson` was pulled fresh from the Census Bureau's TIGERweb
ZCTA layer (`tigerWMS_Census2020`, layer 84) and simplified (Douglas-Peucker, ε=0.0012°)
to keep the file size reasonable — full-resolution TIGER polygons for 39 zips were
~1.7MB; simplified, ~100KB. Wichita's `boundaries.geojson` predates this and was
generalized by whatever process the original Cowork session used.

## Automating St. Louis

St. Louis has no scheduled refresh yet — it needs the same two credentials Wichita's
refresh already has configured, just not yet wired up for this office:

- **RevHawk/FieldRoutes API access** capable of running `pipeline/stlouis/query.sql`
  on a schedule.
- **Google Sheets read access**, once a St. Louis tracking sheet exists (there isn't
  one yet — the calling campaign hasn't started).

Once both exist, extend the same scheduled job Wichita uses to also refresh
`pipeline/stlouis/rows.json` (and `funnel.json`, once that sheet exists) before running
`node pipeline/build.mjs`.

## Notes

- Boundaries are US Census ZCTA polygons, which approximate but don't exactly match
  USPS delivery zips.
- Rural/exurban zips (El Dorado 67042 in Wichita; Wentzville 63385, Eureka 63025 in St.
  Louis) are geographically large and visually dominate the map despite modest customer
  counts — read the panel, not the area.
- The close-rate callout is directional: a few termite plans predate the Wichita
  campaign, so plans ÷ inspections shown slightly overstates conversion. Not applicable
  to St. Louis yet (zero plans sold).
- **This site is public.** GitHub Pages serves publicly regardless of repo visibility.
  Anyone with the link can see zip-level customer counts and revenue, for both
  territories.
