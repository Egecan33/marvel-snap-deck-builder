#!/usr/bin/env node
// Research sample fetch for docs/research/meta-sources.md.
// Serial, >= 1.6 s between requests, hard cap on request count, generic User-Agent,
// no cookies, no personal data. Raw output goes to docs/research/raw/meta/ (gitignored).
//
//   node docs/research/analysis/meta/fetch-sample.mjs
//
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', '..', 'raw', 'meta', 'untapped');
const UA = 'SnapForge/0.1';
const DELAY_MS = 1600;
const MAX_REQUESTS = 60;
const API = 'https://api.snap.untapped.gg/api/v1';

// Values of TimestampRangeFilter found in the site bundle (2026-11-12).
const TIMEFRAMES = [
  'CURRENT_META_PERIOD',
  'EXACTLY_LAST_30_DAYS_NO_CURRENT_LOCATION',
  'EXACTLY_LAST_7_DAYS_NO_CURRENT_LOCATION',
  'EXACTLY_LAST_90_DAYS_NO_CURRENT_LOCATION',
  'CURRENT_LOCATION',
  'LAST_24_HOURS',
  'LAST_48_HOURS',
  'LAST_7_DAYS',
  'LAST_30_DAYS',
  'LAST_90_DAYS',
];
const QUERIES = ['decks_stats_by_pool_v4', 'card_stats_by_pool_v2', 'archetypes_by_pool_v4'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let count = 0;
const log = [];

async function get(name, url) {
  if (count >= MAX_REQUESTS) throw new Error('request cap reached');
  if (count > 0) await sleep(DELAY_MS);
  count += 1;
  const t0 = Date.now();
  let status = 0;
  let bytes = 0;
  let lastModified = null;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
    status = res.status;
    lastModified = res.headers.get('last-modified');
    const body = await res.text();
    bytes = body.length;
    // 202 with an empty body means "query not materialised yet": seen for CURRENT_LOCATION card stats.
    if (res.ok && body.length > 0) writeFileSync(join(OUT, name), body);
    else writeFileSync(join(OUT, name + '.error.txt'), body.slice(0, 2000));
  } catch (err) {
    status = -1;
    writeFileSync(join(OUT, name + '.error.txt'), String(err));
  }
  const row = { name, url, status, bytes, lastModified, ms: Date.now() - t0 };
  log.push(row);
  console.log(`${status} ${String(bytes).padStart(8)}  ${row.ms}ms  ${name}  lm=${lastModified}`);
  return row;
}

mkdirSync(OUT, { recursive: true });

await get('filter-manifest.json', `${API}/filter-manifest`);
await get('archetypes_manifest_v3.json', `${API}/analytics/query/archetypes_manifest_v3`);
await get('current_season.json', `${API}/analytics/query/current_season`);
await get('cards_v2.json', 'https://snapjson.untapped.gg/v2/latest/en/cards.json');
for (const q of QUERIES) {
  for (const tf of TIMEFRAMES) {
    await get(`${q}.${tf}.json`, `${API}/analytics/query/${q}/free?TimestampRangeFilter=${tf}`);
  }
}
// Document what the paid tier returns to an anonymous client (expected: refused).
await get(
  'premium-probe.json',
  `${API}/analytics/query/decks_stats_by_pool_v4/premium?TimestampRangeFilter=CURRENT_META_PERIOD`,
);

writeFileSync(
  join(OUT, '_fetch-log.json'),
  JSON.stringify({ fetchedAt: new Date().toISOString(), userAgent: UA, requests: log }, null, 2),
);
console.log(`done: ${count} requests`);
