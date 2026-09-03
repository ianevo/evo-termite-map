#!/usr/bin/env node
/**
 * Build index.html for the (multi-territory) termite territory map.
 *
 * Inputs, per territory (pipeline/<dir>/):
 *   rows.json          - RevHawk run_query results for query.sql (JSON list, or {"rows": [...]})
 *   funnel.json         - per-zip calling funnel from the team's tracking sheet (optional)
 *   boundaries.geojson  - ZCTA polygons, geometry + zip only
 * Shared (pipeline/):
 *   template.html        - page shell with the __PLACEHOLDER__ tokens
 *   leaflet.js / leaflet.css
 *
 * Output:
 *   ../index.html        - fully self-contained, what GitHub Pages serves
 *
 * Usage: node build.mjs
 */
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const p = (...a) => path.join(HERE, ...a);

const TARGET = 0.30;      // 30% penetration goal
const MIN_ACCOUNTS = 5;   // ignore negligible zips, unless they're in the calling campaign

const TERRITORIES = [
  {
    id: 'wichita', dir: 'wichita', label: 'Wichita',
    state: 'KS', officeLabel: 'Kansas office',
    title: 'Wichita Termite Territory Map',
    subRegion: 'Evo Pest Kansas',
    launched: true,
  },
  {
    id: 'stlouis', dir: 'stlouis', label: 'St. Louis',
    state: 'MO', officeLabel: 'St. Louis office',
    title: 'St. Louis Termite Territory Map',
    subRegion: 'Evo Pest St. Louis',
    launched: false, // program hasn't sold its first plan yet -- no local ARV/penetration signal
  },
];

function g(r, k, d = 0) {
  // RevHawk returns nulls for empty aggregates and {"value": x} for dates.
  let v = r[k] === undefined ? d : r[k];
  if (v && typeof v === 'object') v = v.value;
  return v == null ? d : v;
}

function statusOf(fn) {
  // Campaign status comes from the calling funnel, not from appointments --
  // the sheet is where the team actually tracks which zips are being worked.
  if (!fn || !fn.total_leads) return 'not_in_campaign';
  if (fn.paused) return 'paused';
  const leads = fn.total_leads;
  const called = leads - (fn.left_to_call || 0);
  const rate = leads ? called / leads : 0;
  if (rate >= 0.80) return 'complete';
  if (rate >= 0.15) return 'in_progress';
  return 'queued';
}

function loadJSON(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return fallback;
    throw e;
  }
}

function walkCoords(c, xs, ys) {
  if (typeof c[0] === 'number') { xs.push(c[0]); ys.push(c[1]); }
  else for (const x of c) walkCoords(x, xs, ys);
}

function stamp() {
  const d = new Date();
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

// ---------------------------------------------------------- route ordering
// "Most efficient possible routing" here means: shortest total straight-line (as-the-crow-flies)
// path visiting every zip's centroid exactly once, starting at the zip with the biggest opportunity.
// Nearest-neighbor gives a decent starting tour; full 2-opt cleans up its crossings. At ~40 stops
// this is exact enough in practice and cheap enough to run to convergence on every build.
function haversineMiles(a, b) {
  const R = 3958.8;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const lat1 = a.lat * Math.PI / 180, lat2 = b.lat * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(h));
}

function pathMiles(order, nodes) {
  let total = 0;
  for (let i = 0; i < order.length - 1; i++) total += haversineMiles(nodes[order[i]], nodes[order[i + 1]]);
  return total;
}

function nearestNeighborOrder(nodes, startIdx) {
  const n = nodes.length;
  const visited = new Array(n).fill(false);
  const order = [startIdx];
  visited[startIdx] = true;
  for (let k = 1; k < n; k++) {
    const last = nodes[order[order.length - 1]];
    let best = -1, bestD = Infinity;
    for (let i = 0; i < n; i++) {
      if (visited[i]) continue;
      const d = haversineMiles(last, nodes[i]);
      if (d < bestD) { bestD = d; best = i; }
    }
    order.push(best);
    visited[best] = true;
  }
  return order;
}

function twoOptImprove(order, nodes) {
  let best = order.slice();
  let bestLen = pathMiles(best, nodes);
  let improved = true;
  while (improved) {
    improved = false;
    // i starts at 1, not 0: position 0 (the chosen start zip) stays fixed. The route's
    // other endpoint is free to move -- we only care that it starts where the payoff is biggest.
    for (let i = 1; i < best.length - 1; i++) {
      for (let j = i + 1; j < best.length; j++) {
        const candidate = best.slice(0, i).concat(best.slice(i, j + 1).reverse(), best.slice(j + 1));
        const candidateLen = pathMiles(candidate, nodes);
        if (candidateLen < bestLen - 1e-6) {
          best = candidate;
          bestLen = candidateLen;
          improved = true;
        }
      }
    }
  }
  return { order: best, miles: bestLen };
}

// Attaches route_rank / route_leg_mi / route_cum_mi to each feature's properties in place.
// Returns the total route length in miles.
function computeRoute(feats) {
  const nodes = feats.map(f => ({ lat: f.properties.lat, lng: f.properties.lng }));
  if (nodes.length < 2) {
    if (feats.length) Object.assign(feats[0].properties, { route_rank: 1, route_leg_mi: 0, route_cum_mi: 0 });
    return 0;
  }
  // Start where the payoff is biggest, then follow the shortest path through the rest.
  let startIdx = 0;
  for (let i = 1; i < feats.length; i++) {
    if (feats[i].properties.opportunity_arv > feats[startIdx].properties.opportunity_arv) startIdx = i;
  }
  const nn = nearestNeighborOrder(nodes, startIdx);
  const { order, miles } = twoOptImprove(nn, nodes);

  let cum = 0;
  order.forEach((nodeIdx, i) => {
    const leg = i === 0 ? 0 : haversineMiles(nodes[order[i - 1]], nodes[nodeIdx]);
    cum += leg;
    Object.assign(feats[nodeIdx].properties, {
      route_rank: i + 1,
      route_leg_mi: Math.round(leg * 10) / 10,
      route_cum_mi: Math.round(cum * 10) / 10,
    });
  });
  return Math.round(miles * 10) / 10;
}

function buildTerritory(cfg, fallbackArv) {
  let rows = loadJSON(p(cfg.dir, 'rows.json'), null);
  if (rows == null) throw new Error(`${cfg.dir}/rows.json not found — run query.sql through RevHawk and save the rows there first.`);
  if (!Array.isArray(rows)) rows = rows.rows || [];
  if (!rows.length) throw new Error(`${cfg.dir}/rows.json is empty — the RevHawk query returned nothing.`);

  const funnel = loadJSON(p(cfg.dir, 'funnel.json'), {});
  const hasFunnel = Object.keys(funnel).length > 0;
  if (!hasFunnel) console.log(`NOTE [${cfg.id}]: funnel.json missing — campaign status will read 'not in campaign' everywhere.`);

  const recs = {};
  for (const r of rows) {
    const z = String(g(r, 'zip', '')).trim();
    if (!z) continue;
    const total = Number(g(r, 'total_customers'));
    const fn = funnel[z];
    if (total < MIN_ACCOUNTS && !fn) continue;

    const active = Number(g(r, 'active_customers'));
    const term = Number(g(r, 'active_termite'));
    const ci = Number(g(r, 'cust_inspected'));
    const cs = Number(g(r, 'cust_scheduled'));
    const apay = Number(g(r, 'autopay'));
    const need = Math.ceil(TARGET * active);

    const leads = fn ? Number(fn.total_leads) : 0;
    const sched = fn ? Number(fn.scheduled) : 0;
    const showed = fn ? Number(fn.showed_up) : 0;
    const left = fn ? Number(fn.left_to_call) : 0;
    const nint = fn ? Number(fn.not_interested) : 0;
    const called = leads - left;

    recs[z] = {
      zip: z,
      city: g(r, 'city', '') || '',
      county: g(r, 'county', '') || '',
      total_customers: total,
      active_customers: active,
      active_commercial: Number(g(r, 'active_commercial')),
      active_termite: term,
      termite_arv: Math.round(Number(g(r, 'termite_arv'))),
      total_arv: Math.round(Number(g(r, 'total_arv'))),
      autopay: apay,
      autopay_pct: active ? Math.round(1000 * apay / active) / 10 : 0,
      insp_completed: Number(g(r, 'insp_completed')),
      insp_pending: Number(g(r, 'insp_pending')),
      cust_inspected: ci,
      cust_scheduled: cs,
      insp_coverage_pct: active ? Math.round(1000 * ci / active) / 10 : 0,
      booked_coverage_pct: active ? Math.round(1000 * (ci + cs) / active) / 10 : 0,
      last_inspection: g(r, 'last_inspection', null) || null,
      avg_tenure_yrs: g(r, 'avg_tenure_yrs', null),
      penetration_pct: active ? Math.round(1000 * term / active) / 10 : 0,
      need_at_target: need,
      gap_to_target: Math.max(0, need - term),
      in_campaign: Boolean(fn),
      leads, scheduled: sched, showed_up: showed, left_to_call: left, not_interested: nint, called,
      call_rate_pct: leads ? Math.round(1000 * called / leads) / 10 : 0,
      schedule_rate_pct: leads ? Math.round(1000 * sched / leads) / 10 : 0,
      show_rate_pct: sched ? Math.round(1000 * showed / sched) / 10 : 0,
      close_rate_pct: showed ? Math.round(1000 * term / showed) / 10 : null,
      status: statusOf(fn),
    };
  }

  const arvSum = Object.values(recs).reduce((a, r) => a + r.termite_arv, 0);
  const subSum = Object.values(recs).reduce((a, r) => a + r.active_termite, 0);
  const avgArv = subSum ? Math.round(arvSum / subSum) : fallbackArv;
  for (const r of Object.values(recs)) r.opportunity_arv = r.gap_to_target * avgArv;

  const geo = loadJSON(p(cfg.dir, 'boundaries.geojson'), null);
  if (!geo) throw new Error(`${cfg.dir}/boundaries.geojson not found.`);
  const feats = [];
  const matched = new Set();
  for (const f of geo.features) {
    const z = f.properties.zip;
    if (!recs[z]) continue;
    const xs = [], ys = [];
    walkCoords(f.geometry.coordinates, xs, ys);
    const rec = { ...recs[z] };
    rec.lat = Math.round((Math.min(...ys) + Math.max(...ys)) / 2 * 1e5) / 1e5;
    rec.lng = Math.round((Math.min(...xs) + Math.max(...xs)) / 2 * 1e5) / 1e5;
    feats.push({ type: 'Feature', properties: rec, geometry: f.geometry });
    matched.add(z);
  }
  const missing = Object.keys(recs).filter(z => !matched.has(z)).sort();
  if (missing.length) console.log(`WARNING [${cfg.id}]: no boundary polygon for [${missing}] — these zips are absent from the map.`);
  const orphanFunnel = Object.keys(funnel).filter(z => !matched.has(z)).sort();
  if (orphanFunnel.length) console.log(`WARNING [${cfg.id}]: funnel data for [${orphanFunnel}] has no matching zip on the map.`);
  if (!feats.length) throw new Error(`[${cfg.id}] No zips matched a boundary — nothing to render.`);

  const routeMiles = computeRoute(feats);

  const act = Object.values(recs).reduce((a, r) => a + r.active_customers, 0);
  const trm = Object.values(recs).reduce((a, r) => a + r.active_termite, 0);
  const gap = Object.values(recs).reduce((a, r) => a + r.gap_to_target, 0);
  const lds = Object.values(recs).reduce((a, r) => a + r.leads, 0);
  const cld = Object.values(recs).reduce((a, r) => a + r.called, 0);
  const shw = Object.values(recs).reduce((a, r) => a + r.showed_up, 0);
  console.log(`[${cfg.id}] ${feats.length} zips — active ${act.toLocaleString()} | termite ${trm} | ` +
    `penetration ${act ? (100 * trm / act).toFixed(1) : '0.0'}% | gap to 30% ${gap} plans ($${(gap * avgArv).toLocaleString()}) | avg plan ARV $${avgArv}`);
  console.log(`[${cfg.id}] optimized call route: ${routeMiles} mi across ${feats.length} stops, starting ${feats.find(f => f.properties.route_rank === 1).properties.zip}`);
  if (hasFunnel) {
    console.log(`[${cfg.id}] funnel: ${lds} leads | ${cld} called (${lds ? Math.round(100 * cld / lds) : 0}%) | ${shw} showed up | ${lds - cld} left to call`);
  }

  return {
    id: cfg.id,
    label: cfg.label,
    state: cfg.state,
    officeLabel: cfg.officeLabel,
    title: cfg.title,
    sub: `Termite penetration, calling funnel & inspection progress · ${cfg.subRegion} · ${feats.length} zips`,
    launched: cfg.launched,
    hasFunnel,
    arv: avgArv,
    routeMiles,
    stamp: stamp(),
    geo: { type: 'FeatureCollection', features: feats },
  };
}

// Build the launched territory (Wichita) first so its live average termite ARV
// is available as the cross-market fallback for any territory that hasn't sold
// a plan yet (St. Louis, pre-launch).
const launchedFirst = [...TERRITORIES].sort((a, b) => (b.launched - a.launched));
const built = {};
let referenceArv = 474; // last-resort default if no launched territory exists at all
for (const cfg of launchedFirst) {
  const result = buildTerritory(cfg, referenceArv);
  built[cfg.id] = result;
  if (cfg.launched) referenceArv = result.arv;
}

const territoriesData = {};
for (const cfg of TERRITORIES) territoriesData[cfg.id] = built[cfg.id];
const order = TERRITORIES.map(c => c.id);

const tpl = readFileSync(p('template.html'), 'utf8');
const out = tpl
  .replace('__LEAFLET_CSS__', readFileSync(p('leaflet.css'), 'utf8'))
  .replace('__LEAFLET_JS__', readFileSync(p('leaflet.js'), 'utf8'))
  .replace('__DATA__', JSON.stringify(territoriesData))
  .replace('__ORDER__', JSON.stringify(order));

const dest = p('..', 'index.html');
writeFileSync(dest, out);
console.log(`built ${dest} (${Math.round(statSync(dest).size / 1024)} KB) — ${order.length} territories: ${order.join(', ')}`);
