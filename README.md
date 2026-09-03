# Wichita Termite Territory Map

Interactive zip-code map of preventative termite penetration, the calling funnel, and
inspection progress across the Wichita metro. Built from RevHawk / FieldRoutes data for
the Evo Pest Kansas office plus the team's zip tracking sheet.

**Live map:** https://ianevo.github.io/evo-termite-map/

`index.html` is fully self-contained — Leaflet, boundaries, and data are all inlined.
It works opened directly from disk, with no server and no network.

## What it shows

41 zips across Sedgwick, Butler, and Harvey counties. Five views:

| View | Encodes |
|---|---|
| Campaign status | How far through the call list each zip is |
| Calling progress | % of loaded leads actually called |
| Termite penetration | Active termite plans ÷ active customers |
| Opportunity ($ ARV) | Annual value of the plans still needed to hit 30% |
| Active customers | Book size per zip |

Click any zip for a full profile: penetration against the 30% goal, the complete calling
funnel, opportunity, customer base, and inspection history. The sidebar toggles between
**Opportunity** (where the money is) and **Call queue** (what's blocking the next round
of inspections).

Zips where inspections are landing but plans aren't selling get an explicit callout in
the panel — 8+ inspections shown with under 15% penetration.

## Two data sources, two different questions

- **RevHawk / FieldRoutes** — the customer book, active termite plans, and logged
  inspection appointments. This is the system of record for what was sold and serviced.
- **The tracking sheet** — the calling funnel: leads loaded, called, scheduled, showed
  up, not interested, left to call. This is upstream of RevHawk and is the only place
  that knows which zips are actively being worked.

The two reconcile closely: as of September 2, the sheet reports 155 leads shown up and
RevHawk reports 158 customers inspected this year. Campaign status is driven off the
sheet, because a zip can have leads loaded and zero appointments yet.

## Definitions

- **Penetration** — active termite subscriptions ÷ active customers, per zip.
- **Termite plan** — any office-3 subscription whose service type contains "termite,"
  excluding `Termite Inspection` (that's the appointment, not the plan) and
  `TEST Termite`, with `active='1'` and `dateCancelled='0000-00-00 00:00:00'`.
  Current product is **24 Termite KS**; legacy products are `Termite OUTDATED`
  and `12 Month Termite`.
- **Inspection window** — the current calendar year only. Inspections run annually for
  every customer, so prior-year work is a separate cycle and is excluded.
- **Opportunity ARV** — values each additional plan at the market's live average
  termite plan ARV, recomputed on every build.

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

Runs daily as a scheduled Claude task. To do it by hand:

1. Run `pipeline/query.sql` through RevHawk (`run_query`).
2. Save the returned rows to `pipeline/rows.json` (either a bare JSON list or the
   full `{"rows": [...]}` response — both work).
3. Update `pipeline/funnel.json` from the tracking sheet's per-zip summary table —
   one entry per zip with `total_leads`, `scheduled`, `showed_up`, `left_to_call`,
   `not_interested`. Only zips flagged `CRM = TRUE` in the sheet belong here.
4. `python3 pipeline/build.py` → regenerates `index.html`.
5. Commit and push. GitHub Pages redeploys automatically.

The build prints headline totals so you can sanity-check each run:

```
active 2,589 | termite 64 | penetration 2.5% | gap to 30% 733 plans ($367,233)
funnel: 587 leads | 251 called (43%) | 155 showed up | 336 left to call
```

It also warns if a zip has metrics but no boundary polygon, or funnel data with no
matching zip — both mean a new zip needs adding to `query.sql` and `boundaries.geojson`.

## Repo layout

```
index.html                    the map — what Pages serves
pipeline/
  query.sql                   RevHawk query, one row per zip
  rows.json                   latest query results
  funnel.json                 calling funnel from the tracking sheet
  build.py                    rows + funnel + boundaries -> index.html
  template.html               page shell
  boundaries.geojson          ZCTA polygons, geometry only
  leaflet.js / leaflet.css    inlined into the output
```

## Adding a new zip to the campaign

1. Add the zip to the `IN (...)` list in `pipeline/query.sql`.
2. Add its ZCTA polygon to `pipeline/boundaries.geojson`.
3. Add its funnel row to `pipeline/funnel.json`.

Zips with fewer than 5 all-time accounts are dropped **unless** they appear in
`funnel.json` — so small campaign zips like 67039 Douglass still render.

## Notes

- Boundaries are US Census ZCTA polygons, which approximate but don't exactly match
  USPS delivery zips.
- Rural zips like El Dorado (67042) are geographically large and visually dominate the
  map despite modest customer counts — read the panel, not the area.
- The close-rate callout is directional: a few termite plans predate this campaign, so
  plans ÷ inspections shown slightly overstates conversion.
- **This site is public.** GitHub Pages serves publicly regardless of repo visibility.
  Anyone with the link can see zip-level customer counts and revenue.
