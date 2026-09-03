#!/usr/bin/env python3
import json, os, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
p = lambda *a: os.path.join(HERE, *a)

route = json.load(open(p('route_full.json')))
geo = json.load(open(p('boundaries.geojson')))

# geo features already contain only {"zip": ...} in properties — fine as-is
rank_by_zip = {s['zip']: s['rank'] for s in route['stops']}
cent = {z: None for z in route['zips_meta']}
# recover centroids from route_line isn't 1:1 mapped; recompute from geo bounds like build.py does
def walk(c, xs, ys):
    if isinstance(c[0], (int, float)):
        xs.append(c[0]); ys.append(c[1])
    else:
        for x in c:
            walk(x, xs, ys)

cent = {}
for f in geo['features']:
    z = f['properties']['zip']
    xs, ys = [], []
    walk(f['geometry']['coordinates'], xs, ys)
    cent[z] = [round((min(ys) + max(ys)) / 2, 5), round((min(xs) + max(xs)) / 2, 5)]

data = {
    "geo": geo,
    "zips_meta": route['zips_meta'],
    "stops": route['stops'],
    "route_line": route['route_line'],
    "rankByZip": rank_by_zip,
    "cent": cent,
}

n_remain = len(route['stops'])
total_mi = route['total_miles']
avg_mi = round(total_mi / n_remain, 1) if n_remain else 0
next_stop = route['stops'][0]

try:
    stamp = datetime.date.today().strftime("%B %-d, %Y")
except ValueError:
    stamp = datetime.date.today().strftime("%B %d, %Y").replace(" 0", " ")

tpl = open(p('template_route.html')).read()
out = (tpl.replace("__LEAFLET_CSS__", open(p('leaflet.css')).read())
          .replace("__LEAFLET_JS__", open(p('leaflet.js')).read())
          .replace("__DATA__", json.dumps(data, separators=(",", ":")))
          .replace("__NREMAIN__", str(n_remain))
          .replace("__TOTALMI__", str(total_mi))
          .replace("__AVGMI__", str(avg_mi))
          .replace("__NEXTZIP__", next_stop['zip'])
          .replace("__NEXTCITY__", next_stop['city'])
          .replace("__STAMP__", stamp))

dest = p('route_plan.html')
open(dest, 'w').write(out)
print(f"built {dest} ({round(os.path.getsize(dest)/1024)} KB) — {n_remain} remaining zips, {total_mi} mi route")
