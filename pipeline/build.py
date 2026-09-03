#!/usr/bin/env python3
"""
Build index.html for the Wichita termite territory map.

Inputs (all in this directory):
  rows.json          - RevHawk run_query results for query.sql (JSON list of row objects)
  funnel.json        - per-zip calling funnel from the team's tracking sheet
  boundaries.geojson - ZCTA polygons, geometry + zip only
  template.html      - page shell with the __PLACEHOLDER__ tokens
  leaflet.js / leaflet.css

Output:
  ../index.html      - fully self-contained, what GitHub Pages serves

Usage:  python3 build.py
"""
import json, math, os, sys, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
p = lambda *a: os.path.join(HERE, *a)

TARGET = 0.30          # 30% penetration goal
MIN_ACCOUNTS = 5       # ignore negligible zips, unless they're in the calling campaign

# ---------------------------------------------------------------- load
try:
    rows = json.load(open(p("rows.json")))
except FileNotFoundError:
    sys.exit("rows.json not found — run query.sql through RevHawk and save the rows here first.")
if isinstance(rows, dict):
    rows = rows.get("rows", [])
if not rows:
    sys.exit("rows.json is empty — the RevHawk query returned nothing.")

try:
    funnel = json.load(open(p("funnel.json")))
except FileNotFoundError:
    funnel = {}
    print("NOTE: funnel.json missing — campaign status will read 'not in campaign' everywhere.")


def g(r, k, d=0):
    """RevHawk returns nulls for empty aggregates and {'value': x} for dates."""
    v = r.get(k, d)
    if isinstance(v, dict):
        v = v.get("value")
    return d if v is None else v


def status_of(fn):
    """
    Campaign status comes from the calling funnel, not from appointments —
    the sheet is where the team actually tracks which zips are being worked.
    """
    if not fn or fn.get("total_leads", 0) == 0:
        return "not_in_campaign"
    if fn.get("paused"):
        return "paused"
    leads = fn["total_leads"]
    called = leads - fn.get("left_to_call", 0)
    rate = called / leads if leads else 0
    if rate >= 0.80:
        return "complete"
    if rate >= 0.15:
        return "in_progress"
    return "queued"


# ------------------------------------------------------- derive metrics
recs = {}
for r in rows:
    z = str(g(r, "zip", "")).strip()
    if not z:
        continue
    total = int(g(r, "total_customers"))
    fn = funnel.get(z)
    if total < MIN_ACCOUNTS and not fn:
        continue

    active = int(g(r, "active_customers"))
    term = int(g(r, "active_termite"))
    ci, cs = int(g(r, "cust_inspected")), int(g(r, "cust_scheduled"))
    apay = int(g(r, "autopay"))
    need = math.ceil(TARGET * active)

    leads = int(fn["total_leads"]) if fn else 0
    sched = int(fn["scheduled"]) if fn else 0
    showed = int(fn["showed_up"]) if fn else 0
    left = int(fn["left_to_call"]) if fn else 0
    nint = int(fn["not_interested"]) if fn else 0
    called = leads - left

    recs[z] = {
        "zip": z,
        "city": g(r, "city", "") or "",
        "county": g(r, "county", "") or "",
        "total_customers": total,
        "active_customers": active,
        "active_commercial": int(g(r, "active_commercial")),
        "active_termite": term,
        "termite_arv": round(float(g(r, "termite_arv"))),
        "total_arv": round(float(g(r, "total_arv"))),
        "autopay": apay,
        "autopay_pct": round(100 * apay / active, 1) if active else 0,
        "insp_completed": int(g(r, "insp_completed")),
        "insp_pending": int(g(r, "insp_pending")),
        "cust_inspected": ci,
        "cust_scheduled": cs,
        "insp_coverage_pct": round(100 * ci / active, 1) if active else 0,
        "booked_coverage_pct": round(100 * (ci + cs) / active, 1) if active else 0,
        "last_inspection": g(r, "last_inspection", None) or None,
        "avg_tenure_yrs": g(r, "avg_tenure_yrs", None),
        "penetration_pct": round(100 * term / active, 1) if active else 0,
        "need_at_target": need,
        "gap_to_target": max(0, need - term),
        # calling funnel
        "in_campaign": bool(fn),
        "leads": leads,
        "scheduled": sched,
        "showed_up": showed,
        "left_to_call": left,
        "not_interested": nint,
        "called": called,
        "call_rate_pct": round(100 * called / leads, 1) if leads else 0,
        "schedule_rate_pct": round(100 * sched / leads, 1) if leads else 0,
        "show_rate_pct": round(100 * showed / sched, 1) if sched else 0,
        # rough: some plans predate the campaign, so treat as directional
        "close_rate_pct": round(100 * term / showed, 1) if showed else None,
        "status": status_of(fn),
    }

# Value each additional plan at the market's live average termite ARV
arv_sum = sum(r["termite_arv"] for r in recs.values())
sub_sum = sum(r["active_termite"] for r in recs.values())
AVG_ARV = round(arv_sum / sub_sum) if sub_sum else 474
for r in recs.values():
    r["opportunity_arv"] = r["gap_to_target"] * AVG_ARV

# ------------------------------------------------------ attach geometry
geo = json.load(open(p("boundaries.geojson")))
feats, matched = [], set()
for f in geo["features"]:
    z = f["properties"]["zip"]
    if z not in recs:
        continue
    xs, ys = [], []

    def walk(c):
        if isinstance(c[0], (int, float)):
            xs.append(c[0]); ys.append(c[1])
        else:
            for x in c:
                walk(x)

    walk(f["geometry"]["coordinates"])
    rec = dict(recs[z])
    rec["lat"] = round((min(ys) + max(ys)) / 2, 5)
    rec["lng"] = round((min(xs) + max(xs)) / 2, 5)
    feats.append({"type": "Feature", "properties": rec, "geometry": f["geometry"]})
    matched.add(z)

missing = sorted(set(recs) - matched)
if missing:
    print(f"WARNING: no boundary polygon for {missing} — these zips are absent from the map.")
orphan_funnel = sorted(set(funnel) - matched)
if orphan_funnel:
    print(f"WARNING: funnel data for {orphan_funnel} has no matching zip on the map.")
if not feats:
    sys.exit("No zips matched a boundary — nothing to render.")

# ------------------------------------------------------------- render
try:
    stamp = datetime.date.today().strftime("%B %-d, %Y")
except ValueError:                     # platforms without %-d
    stamp = datetime.date.today().strftime("%B %d, %Y").replace(" 0", " ")

tpl = open(p("template.html")).read()
out = (tpl.replace("__LEAFLET_CSS__", open(p("leaflet.css")).read())
          .replace("__LEAFLET_JS__", open(p("leaflet.js")).read())
          .replace("__DATA__", json.dumps({"type": "FeatureCollection", "features": feats},
                                          separators=(",", ":")))
          .replace("__STAMP__", stamp)
          .replace("__ARV__", str(AVG_ARV))
          .replace("__NZIPS__", str(len(feats))))

dest = p("..", "index.html")
open(dest, "w").write(out)

act = sum(r["active_customers"] for r in recs.values())
trm = sum(r["active_termite"] for r in recs.values())
gap = sum(r["gap_to_target"] for r in recs.values())
lds = sum(r["leads"] for r in recs.values())
cld = sum(r["called"] for r in recs.values())
shw = sum(r["showed_up"] for r in recs.values())
print(f"built {dest} ({round(os.path.getsize(dest)/1024)} KB) — {len(feats)} zips, {stamp}")
print(f"active {act:,} | termite {trm} | penetration {100*trm/act:.1f}% | "
      f"gap to 30% {gap} plans (${gap*AVG_ARV:,}) | avg plan ARV ${AVG_ARV}")
print(f"funnel: {lds} leads | {cld} called ({100*cld/lds:.0f}%) | {shw} showed up | "
      f"{lds-cld} left to call")
