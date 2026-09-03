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

  const act = Object.values(recs).reduce((a, r) => a + r.active_customers, 0);
  const trm = Object.values(recs).reduce((a, r) => a + r.active_termite, 0);
  const gap = Object.values(recs).reduce((a, r) => a + r.gap_to_target, 0);
  const lds = Object.values(recs).reduce((a, r) => a + r.leads, 0);
  const cld = Object.values(recs).reduce((a, r) => a + r.called, 0);
  const shw = Object.values(recs).reduce((a, r) => a + r.showed_up, 0);
  console.log(`[${cfg.id}] ${feats.length} zips — active ${act.toLocaleString()} | termite ${trm} | ` +
    `penetration ${act ? (100 * trm / act).toFixed(1) : '0.0'}% | gap to 30% ${gap} plans ($${(gap * avgArv).toLocaleString()}) | avg plan ARV $${avgArv}`);
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
