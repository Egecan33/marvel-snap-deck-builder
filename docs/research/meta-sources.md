# Meta and play-rate data sources

Researched 2026-11-12 (local, GMT+3); all requests below were made between 2026-11-11 21:20 and 21:50 UTC.
Every status, count and sample in this file was measured live with `User-Agent: SnapForge/0.1`, no cookies, serial
requests at least 1.6 s apart. Nothing here comes from memory. Request total: about 31 exploratory, 22 static JS
chunks (to read the Untapped client code), 37 for the sample. No rate limiting was hit anywhere.

Scripts: `docs/research/analysis/meta/fetch-sample.mjs`, `docs/research/analysis/meta/analyze-sample.mjs`.
Raw output: `docs/research/raw/meta/` (gitignored, 17 MB).

## 1. Verdict

| Need | Primary | Fallback |
|---|---|---|
| Meta decklists with popularity and win rate | Untapped.gg `decks_stats_by_pool_v4` (4,763 lists this meta period, one request) | marvelsnap.pro `getmeta` (19 archetype skeletons) and `getdecks` (user lists, thin) |
| Per-card play rate and win rate | Derive from the Untapped decks file (all ranks); cross-check with Untapped `card_stats_by_pool_v2` (ranks up to Vibranium only) | none usable found |
| Archetype labels | Untapped `arch_id` on each list plus `archetypes_manifest_v3` (494 named archetypes with core cards) | marvelsnap.pro `getmeta` `structure` (cards flagged `crucial`) |
| Card-pair co-occurrence | Compute from the Untapped decks file | none |

Not usable: Marvel Snap Zone `getinfo` (its robots.txt now disallows it), snap.fan decks (Cloudflare challenge),
Kaggle dataset (needs an account; contents not inspected), GitHub (no deck dataset found).

## 2. Sources tested

### 2.1 Untapped.gg (works, recommended)

Site `https://snap.untapped.gg`, `robots.txt` is `User-agent: * / Allow: /` (200). The API host has no robots file:
`https://api.snap.untapped.gg/robots.txt` returns 403 `{"message":"Missing Authentication Token"}` (API gateway
default). The terms of service were not read; see open questions.

Base: `https://api.snap.untapped.gg/api/v1/`. Found by reading the Next.js bundle
(`static.snap.untapped.gg/_next/static/chunks/pages/_app-2e42c957379734b6.js` and chunk `9953-…js`).
Anonymous access works for the `/free` partition. `/premium` returns 403 `Permission denied … partitions ('premium',)`.

| Endpoint | Result (2026-11-11 UTC) |
|---|---|
| `filter-manifest` | 200, 2 KB. Current meta period, data volumes, hot location. `Cache-Control: public, max-age=60` |
| `analytics/query/current_season` | 200. `{"current_season":"November2026","previous_season":"October2026"}` |
| `analytics/query/archetypes_manifest_v3` | 200, 174 KB. 494 archetypes (438 `active`) |
| `analytics/query/decks_stats_by_pool_v4/free?TimestampRangeFilter=…` | 200, 1.36 MB for the current period: 4,763 lists |
| `analytics/query/archetypes_by_pool_v4/free?TimestampRangeFilter=…` | 200, 15 KB: 48 archetypes with games and wins per rank |
| `analytics/query/card_stats_by_pool_v2/free?TimestampRangeFilter=…` | 200, 332 KB: 511 cards |
| `https://snapjson.untapped.gg/v2/latest/en/cards.json` | 200, 378 KB: 791 card defs, 512 `collectible`, with `series` and `seriesStartTimestamps` |

There is no pagination: each query returns the whole result in one response. Responses carry `Last-Modified` and
`ETag`; a conditional request with `If-None-Match` returned 304 with an empty body (tested on the archetype query).
Files were regenerated between 19:05 and 21:45 UTC on the day of the test, so they refresh at least every few hours.

`TimestampRangeFilter` values, tested on all three queries:

| Value | Status | Lists | Games | Min games per list |
|---|---|---|---|---|
| `CURRENT_META_PERIOD` | 200 | 4,763 | 345,062 | 20 |
| `EXACTLY_LAST_30_DAYS_NO_CURRENT_LOCATION` | 200 | 5,973 | 1,006,705 | 40 |
| `EXACTLY_LAST_7_DAYS_NO_CURRENT_LOCATION` | 200 | 8,198 | 305,375 | 10 |
| `CURRENT_LOCATION` (hot location only) | 200 (card stats: 202, empty body) | 558 | 5,872 | 5 |
| `EXACTLY_LAST_90_DAYS_NO_CURRENT_LOCATION` | 200 | 213 | 27,055 | 40 |
| `LAST_24_HOURS`, `LAST_48_HOURS` | 403 permission denied (paid) | | | |
| `LAST_7_DAYS`, `LAST_30_DAYS`, `LAST_90_DAYS` | 400 invalid filter value | | | |

The 90-day file is not what its name suggests: 213 lists spread evenly over low ranks with a 234-card index. Do not use it.

**Decks response shape.** `{"data":[row…],"metadata":{"d_map":[defId…]}}`. A row:

```json
{"d":[1,3,10,27,46,129,178,251,258,324,432,434],
 "POOL3 (8000-16000)":{"arch_id":892,"alt_arch_id":null,"Omega":[26,18,-9.816],"Vibranium":[7,2,-9.942]}}
```

- `d` is 12 indexes into `metadata.d_map` of **the same response**. The index is not stable: it had 510 entries for the
  current period, 511 for 7 and 30 days, 468 for the hot location. Always decode with the response's own `d_map`.
  The values are `CardDefId` strings (`ArthurPendragon`, `ScarletWitchQueenOfChaos`), the same key that
  `snapjson` cards, marvelsnap.pro and the game's deck codes use.
- Other keys are collection-level buckets: `POOL1`, `POOL2`, `POOL3 (500-8000)`, `POOL3 (8000-16000)`,
  `POOL3 (16000-24000)`, `POOL3 (24000+)`. A list can appear in several.
- Inside a bucket, each rank key (`Iron` … `Infinite`) holds `[num_games, num_wins, avg_cubes]`. This reading comes
  from the client code (`num_games:m[0], num_wins:m[1]`, third value assigned to `avg_cubes`). In the free partition
  the third value is passed through a client-side transform and arrives as numbers near -9.8, so **cube rate is not
  available** to us. Do not display it.
- `arch_id` is the assigned archetype; `alt_arch_id` is called "archetype candidate" in the client code.
- There is no per-list date. The time window is the query parameter.

**Archetype manifest shape.** `data[archId] = {arch_name, card_popularity:{defId: percent of the archetype's lists},
art_tiles:[3 defIds], pool, active}`. Example: `1330 → Arthur`, 79 cards listed, `ArthurPendragon` 100, `DrDoom` 88.3,
`IronLad` 88. This is enough to build an archetype "core" (cards at or above some percentage) without hand tagging.

**Archetype stats shape.** `data[archId].POOL3[rank] = [num_games, num_wins, cubes]`, all ranks including Infinite,
no list threshold: 576,711 games for the current period.

**Card stats shape.** `data[defId].POOL3[rank] = {num_matches, popularity, adj_popularity, winrate, tier_val}`, and
`metadata.matches.POOL3[rank]` gives the denominators. Free partition contains ranks **Iron to Vibranium only**
(136,353 matches, 24% of the 576,711 tracked games). Omega, Galactic and Infinite are missing here, although the
decks and archetype queries do include them.

**Patch tagging.** `filter-manifest.current_meta_period` = `{"id":137,"start_ts":"2026-11-03T20:01:54Z",
"description":"Nov 3 - Knights of Avalon Season", data_volume:{min:{num_games:345062,num_decks:4763},
"200":{num_games:153443,num_decks:217}}}`. `current_location` gives the hot location (`NiamhsLake`, from
2026-11-11T19:05Z). The `num_decks` and `num_games` in the manifest matched the decks file exactly.

**Server-rendered pages.** `https://snap.untapped.gg/en/meta` embeds `__NEXT_DATA__.props.pageProps.ssrTierList`:
11 of 34 archetypes with `tier`, `popularity`, `winrate`, `numGames`, `numDecks`, but on a filtered subset
(29,523 games) whose filter I could not identify. `…/en/meta/decks` embeds 12 lists. Use the API, not the pages.

### 2.2 marvelsnap.pro (works, thin)

`robots.txt` (200): everything allowed for `*` except `/wp-admin/`, `/*?s=`, `/builder/*/`; named SEO crawlers get
`Crawl-delay: 10`. Endpoints found in `main.df539443d9d1d98e5885.js`:

- `GET https://marvelsnap.pro/snap/do.php?cmd=getmeta` → 200, 4.3 KB. `{sum, archetypes[19], decks}`.
  `sum = {decks_count:523, win:28, loss:15, cubes_won:75, cubes_lost:34}`. Each archetype: `id, name, decks_count,
  supertype, abils, win, loss, cubes_won, cubes_lost, start, end` (unix; 2026-11-04 to 2026-11-11), `pool1..pool5`,
  `structure[{CardDefId, weight, crucial, source}]` (15 entries for the first one), `sampleStructure[12 defIds]`.
  The client also sends `limit, rankScope, sort, colLevel, timeFrame, format`; values were not tested.
  With 43 recorded games in total, its win rates are noise. Its value is the archetype names and `crucial` cards.
- `GET https://marvelsnap.pro/snap/do.php?cmd=getdecks` → 200, 6.4 KB, 27 user-published lists dated 2026-11-03 to
  2026-11-10. Fields: `slug, humanname, date, date_edited, archetype, supertype, tags, code` (base64 JSON deck code),
  `fingerprint, views, public_wins, public_loss, public_cube_wins, public_cube_loss, deck[12 defIds]`, plus
  `author` and `authornick`. The client pages with an `rq=<json>` parameter; not tested. Only 1 of 27 had an
  archetype. **Do not store `author` or `authornick`.**
- Also present, not tested: `getcards`, `getcardsynergy` (POST `cardId`), `getdeck&slug=`.

### 2.3 Marvel Snap Zone (do not use the API)

`https://marvelsnapzone.com/robots.txt` (200) now contains, for `User-agent: *`:
`Disallow: /getinfo/`, `Disallow: /msz-api/`, `Disallow: /pro/`, `Disallow: /img/deckpreview.php`, under the comment
`MSZ crawl budget (2026-08-28, hardened 2026-09-18)`. It also disallows several AI crawlers site-wide.

Two requests were made before this was read: `getinfo/?searchtype=cards&searchcardstype=true` returned 200 with
3.1 MB of card data (fields `cid, name, type, cost, power, ability, status, carddefid, variants, source, tags…`), and
`getinfo/?searchtype=decks` with no further parameters returned 200 `{"total_time":"0.01s "}` (no decks). No more
requests were made. The endpoint still answers, but the site has said no, so Snap Forge should not sync from it.

`https://marvelsnapzone.com/tier-list/` is allowed: 200, 440 KB HTML, `article:modified_time` 2026-11-08, 14 deck
links. It is an editorial tier list, useful to a human, not a data feed.

### 2.4 snap.fan (blocked)

`robots.txt` (200) allows everything. `https://snap.fan/cards/` → 200 (678 KB of HTML, no play-rate or win-rate
text found). `https://snap.fan/decks/` → **403 Cloudflare "Just a moment…"** with `SnapForge/0.1` and again with a
desktop Chrome User-Agent. It needs a real browser to pass the challenge; not suitable for a sync CLI.

### 2.5 Public datasets

- Kaggle: `https://www.kaggle.com/api/v1/datasets/list?search=marvel+snap` → 200, one result:
  `jeanmidev/marvel-snap-decks-and-cards`, version 23, updated 2026-11-09, 48.4 MB, licence "Other (specified in
  description)". Downloading needs a Kaggle account, which this project must not use in requests, so the contents
  and their sources are unverified. A person could download it once by hand to inspect.
- GitHub: `api.github.com/search/repositories?q=marvel+snap+decks` → 200, 33 repositories, all trackers, builders or
  bots. No decklist or play-rate dataset.

## 3. Sample and measurements

Sample: Untapped `decks_stats_by_pool_v4`, `CURRENT_META_PERIOD` (2026-11-03 20:01 UTC to 2026-11-11 about 21:40 UTC,
meta period 137, season November2026), plus the matching card stats, archetype stats and manifest. Fetched
2026-11-11T21:47Z. Reproduce with the two scripts; pass another timeframe name to the analysis script to compare.

| Measure | Value |
|---|---|
| Distinct lists (all 12 distinct cards, no duplicate card sets) | 4,763 |
| Games behind them | 345,062, pooled win rate 57.7% |
| Games per list | min 20, median 32, p90 100, p99 797, max 7,383 |
| Lists with at least 50 / 100 / 200 games | 1,287 / 477 / 217 |
| Games by rank | Infinite 36.4%, Omega 23.8%, Galactic 20.2%, Vibranium 16.2%, Diamond 2.6%, below 0.8% |
| Share of all tracked games that these lists cover | 59.8% (345,062 of 576,711 in the archetype query) |
| Released collectible cards (`cards.json`, series start in the past) | 511 |
| Cards in under 1% of lists | **235 of 511 (46%)**; one card (`Redwing`) in zero lists |
| Cards in at least 2% / 5% / 10% of lists | 176 / 67 / 20 |
| Deck slots | half are filled by the top 65 cards, 80% by the top 182 |
| Distinct card pairs seen | 34,984 of 129,795 possible (27%) |
| Pairs with support of at least 48 lists (1%) | 1,285; lift ≥ 2: 1,066; lift ≥ 5: 556; lift < 0.5: 13 |
| Labelled archetypes present | 44 (48 in the archetype query) |
| Lists without `arch_id` | 27.8% of lists, 19.4% of games (1,321 of those 1,324 have an `alt_arch_id`) |
| **Top 10 archetypes** | **49.9% of games, 44.5% of lists** |

The 30-day file gives nearly the same picture (5,973 lists, 234 cards under 1%, top 10 archetypes 45.4% of games), so
these are properties of the game, not of one week.

Distance from each list to its nearest other list (number of cards that differ):

| Cards different | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 |
|---|---|---|---|---|---|---|---|---|---|
| Lists | 2,296 | 894 | 612 | 396 | 261 | 183 | 89 | 28 | 4 |

48% of known lists are one card away from another known list and 80% are within three. Only 304 lists (6.4%) are six
or more cards from everything else. A brew that differs from every synced list by six or more cards is already
rarer than 94% of what tracker users play; that is a reasonable first anchor for the novelty scale (heuristic).

### Top 30 cards by share of lists

Share of lists, then share of games, then win rate of the lists that contain the card (baseline 57.7%).

| # | Card | Lists | Games | WR | # | Card | Lists | Games | WR |
|---|---|---|---|---|---|---|---|---|---|
| 1 | IronLad | 22.9% | 21.7% | 57.9% | 16 | MajesticWingbeat | 11.2% | 13.9% | 58.7% |
| 2 | ArthurPendragon | 22.0% | 20.5% | 57.1% | 17 | Venus | 11.1% | 11.9% | 60.1% |
| 3 | AntiPolarMagneto | 21.6% | 21.0% | 58.6% | 18 | ShangChi | 10.6% | 8.4% | 57.6% |
| 4 | ScarletWitchQueenOfChaos | 19.6% | 23.9% | 59.8% | 19 | CalibanHorseman | 10.2% | 12.4% | 58.7% |
| 5 | ShadowKing | 19.1% | 22.1% | 58.4% | 20 | Surge | 10.1% | 10.5% | 56.5% |
| 6 | Zabu | 15.5% | 13.0% | 56.6% | 21 | Psylocke | 10.0% | 8.6% | 55.9% |
| 7 | VampireKillmonger | 15.3% | 16.6% | 60.0% | 22 | CaptainMarvel | 9.4% | 10.2% | 59.0% |
| 8 | Magik | 15.1% | 13.4% | 54.9% | 23 | ThanosFracturedFrontier | 9.3% | 10.8% | 59.8% |
| 9 | DrDoom | 14.5% | 13.3% | 57.4% | 24 | Mordred | 9.3% | 6.9% | 56.0% |
| 10 | CaptainBritain | 14.4% | 14.0% | 56.2% | 25 | MerlinOfAvalon | 8.7% | 9.7% | 58.5% |
| 11 | LukeCage | 13.6% | 10.4% | 57.8% | 26 | EnSabahNur | 8.7% | 11.0% | 59.1% |
| 12 | Doom2099 | 12.9% | 12.1% | 57.4% | 27 | Quinjet | 8.4% | 6.8% | 56.8% |
| 13 | Jubilee | 12.9% | 12.0% | 58.4% | 28 | Sasquatch | 8.0% | 9.9% | 60.5% |
| 14 | MobiusMMobius | 12.3% | 17.7% | 59.0% | 29 | Mystique | 7.8% | 6.9% | 54.6% |
| 15 | Cosmo | 11.4% | 10.0% | 57.9% | 30 | ArnimZola | 7.7% | 7.0% | 55.5% |

No card is in a quarter of lists. Marvel Snap has no universal staple at the level other card games do, so a
"staple penalty" will be weak; novelty has to come from pairs and from distance to whole lists.

### Top 30 pairs by lift

Lift = P(both) / (P(a) × P(b)) over the 4,763 lists, unweighted, minimum support 48 lists. `conf` is the share of
the rarer card's lists that also hold the other card.

| # | Pair | Lists | Lift | Conf | # | Pair | Lists | Lift | Conf |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Batroc + HydraStomper | 53 | 64.6 | 85% | 16 | Abomination + MistyKnight | 86 | 41.6 | 93% |
| 2 | Batroc + Silk | 53 | 60.7 | 84% | 17 | HighEvolutionary + MistyKnight | 89 | 40.0 | 90% |
| 3 | HydraStomper + Silk | 52 | 60.5 | 84% | 18 | HighEvolutionary + Shocker | 61 | 39.7 | 82% |
| 4 | HydraStomper + Kraven | 58 | 50.6 | 94% | 19 | SebastianShaw + SilverSurfer | 58 | 39.6 | 77% |
| 5 | Kraven + Silk | 61 | 50.0 | 92% | 20 | Hazmat + ScorpionBrandNewDay | 80 | 37.8 | 83% |
| 6 | Batroc + Kraven | 58 | 49.8 | 92% | 21 | ZombieNova + ZombieVenom | 67 | 37.4 | 75% |
| 7 | DeathFracturedFrontier + Firehair | 48 | 49.5 | 72% | 22 | CorvusGlaive + Khonshu | 63 | 36.0 | 81% |
| 8 | Abomination + Cyclops | 87 | 46.4 | 95% | 23 | HighEvolutionary + Hulk | 93 | 35.8 | 94% |
| 9 | Cyclops + HighEvolutionary | 92 | 45.6 | 95% | 24 | JaneFoster + MrNegative | 60 | 34.6 | 77% |
| 10 | Bullseye + Miek | 50 | 45.4 | 71% | 25 | HellcowFracturedFrontier + ScorpionBrandNewDay | 68 | 34.4 | 71% |
| 11 | Abomination + HighEvolutionary | 86 | 45.0 | 93% | 26 | Arishem + Blob | 69 | 34.2 | 93% |
| 12 | Abomination + Shocker | 62 | 43.4 | 84% | 27 | Brood + SilverSurfer | 72 | 34.1 | 77% |
| 13 | Cyclops + Shocker | 65 | 43.1 | 88% | 28 | Abomination + Hulk | 82 | 34.0 | 89% |
| 14 | MistyKnight + Shocker | 71 | 42.7 | 96% | 29 | Cyclops + Hulk | 86 | 33.8 | 89% |
| 15 | Cyclops + MistyKnight | 93 | 42.7 | 96% | 30 | Deadpool + Deathlok | 84 | 33.1 | 77% |

The top of the lift table is a handful of package decks (move, High Evolutionary, Surfer) counted many times through
their near-identical variants. Raw lift therefore rewards "is in a tight package", not "is a strong interaction".
For the interaction network, count pair support over lists after collapsing near-duplicates (for example one vote per
archetype, or per cluster of lists within two cards), and keep lift only as evidence beside a mechanical reason.

### Bias in this sample (read before using the numbers)

1. **Tracker users only.** The data comes from people who run the Untapped companion. 80% of the games are Omega or
   higher and 36% are Infinite. This is the engaged, high-rank population, not the player base.
2. **Win rates are inflated and not comparable across files.** The pooled win rate is 57.7% in the decks file, 56.7%
   in the archetype file and 64.6% in the card stats file (lower ranks). Only the tracker user's side is recorded,
   and opponents include bots at low ranks. Store win rate as a **delta against the pooled win rate of the same
   file and rank band**, never as an absolute number.
3. **The tail is cut off, and the tail is what this app cares about.** Lists need 20 games in the period to appear.
   The lists we get cover 59.8% of tracked games; the other 40% of games are played with lists we never see, and
   those are exactly the one-off brews. "Not in the meta file" means "not played 20 times by one tracked list", not
   "nobody has tried it". Card play rate from this file is biased towards established lists for the same reason.
4. **Card stats cover low ranks only** (24% of games). Rank agreement between card-stats play rate and the
   decks-file game share is high (Spearman 0.948 over 510 cards) but not exact; prefer the decks file for play rate
   and say which one a number came from.
5. **Early-season skew.** The period is 8 days old and season cards (ArthurPendragon, CaptainBritain,
   MerlinOfAvalon, Mordred, released 2026-11-03 to 11-10 per `seriesStartTimestamps`) fill the top of the table.
6. **Archetype labels are Untapped's own classifier.** 28% of lists carry none, names are terse ("Created Cards
   Deck", "Galacti") and one family can be split ("Destroy" appears as #108 and #151).

## 4. Sync recipe (`pnpm sync meta`)

All requests serial, 2 s apart, `User-Agent: SnapForge/<version>`, `Accept: application/json`, no cookies. Send
`If-None-Match` with the stored ETag and skip parsing on 304. Cap at 12 requests per run. At most one run per 6 h
(the manual sync button should refuse earlier). On any non-200/304, keep the previous snapshot and report it.

1. `GET /filter-manifest` → read `current_meta_period.{id,start_ts,description}` and `current_location`.
2. `GET /analytics/query/current_season`.
3. `GET https://snapjson.untapped.gg/v2/latest/en/cards.json` only to validate defIds against the app's own card
   table (the card sync owns card data). Unknown defIds are logged and their lists kept but flagged.
4. `GET /analytics/query/archetypes_manifest_v3`.
5. `GET /analytics/query/decks_stats_by_pool_v4/free?TimestampRangeFilter=CURRENT_META_PERIOD`.
6. `GET /analytics/query/archetypes_by_pool_v4/free?TimestampRangeFilter=CURRENT_META_PERIOD`.
7. `GET /analytics/query/card_stats_by_pool_v2/free?TimestampRangeFilter=CURRENT_META_PERIOD`.
8. If step 5 has fewer than 1,000 lists (first days after a patch), also fetch steps 5 to 7 with
   `EXACTLY_LAST_30_DAYS_NO_CURRENT_LOCATION` and store it as a separate snapshot marked "previous patches included".
9. Optional fallback, only if step 5 fails twice: `GET https://marvelsnap.pro/snap/do.php?cmd=getmeta` and store its
   archetypes as skeleton lists (`structure` cards with `crucial = 1`), marked low confidence.

Validate before replacing the stored snapshot: every `d` has 12 distinct indexes inside `d_map`; list count within a
factor of 5 of the previous snapshot; `filter-manifest` volumes equal the parsed totals (they did in this test).

Normalised shape to store (SQLite; names are a proposal, to be reconciled with `src/engine/types.ts`):

```ts
interface MetaSnapshot {            // one per source + timeframe + fetch
  id: string;                       // e.g. "untapped:CURRENT_META_PERIOD:137:2026-11-11T21:38:54Z"
  source: 'untapped' | 'marvelsnap.pro';
  timeframe: string;                // the TimestampRangeFilter value
  metaPeriodId: number | null;      // 137
  metaPeriodStart: string | null;   // ISO, from filter-manifest
  metaPeriodLabel: string | null;   // "Nov 3 - Knights of Avalon Season"
  season: string | null;            // "November2026"
  sourceLastModified: string;       // response Last-Modified
  fetchedAt: string;
  etag: string | null;
  totalGames: number; totalWins: number;   // baseline for win-rate deltas
  minGamesPerList: number;          // observed threshold (20 here)
}
interface MetaList {
  snapshotId: string;
  listKey: string;                  // sorted defIds joined with "|", also the dedupe key
  cards: string[];                  // 12 CardDefIds
  archetypeId: number | null;       // arch_id
  archetypeCandidateId: number | null; // alt_arch_id
  games: number; wins: number;      // summed over buckets and ranks
  gamesByRank: Record<string, [games: number, wins: number]>;
}
interface MetaArchetype {
  snapshotId: string; archetypeId: number; name: string; active: boolean;
  cardShare: Record<string, number>;   // card_popularity, percent
  games: number; wins: number;         // from archetypes_by_pool_v4, all ranks
}
interface MetaCardStat {            // derived in the sync step, not fetched
  snapshotId: string; card: string;
  lists: number; listShare: number; games: number; gameShare: number; wins: number;
  lowRankMatches: number | null; lowRankWinRate: number | null; // from card_stats, Iron..Vibranium
}
```

Pair counts are derived at sync time from `MetaList` and stored as `(snapshotId, a, b, lists, games)` for pairs with
at least 5 lists; about 35,000 distinct pairs exist before that cut, so the table stays small.

## 5. Data-quality rules

- **Staleness after a balance patch.** Tie every number to `metaPeriodId`. When `filter-manifest` reports a new id,
  the old snapshot becomes "previous patch": still usable for distance-to-known-lists (lists do not stop existing),
  not for win rates or play rates. Whether Untapped opens a new period on every OTA or only on patches and seasons
  is not verified; until it is, also compare `metaPeriodStart` with the balance-change dates in the app's own
  patch data and warn when a change is newer than the period start.
- **The UI must always show** source, time window, rank mix and games behind any win rate or play rate.
- **Duplicates.** Within one response there were none (4,763 rows, 4,763 distinct card sets). Across timeframes and
  sources the same list recurs; dedupe on `listKey` and keep per-snapshot stats separate. Near-duplicates are the
  real issue (48% of lists are one card from another); collapse them when counting pair evidence and when showing
  "closest known lists".
- **Thin data.** Median list has 32 games. Show a win rate only above a floor (suggest 200 games; 217 lists pass)
  and shrink it towards the snapshot baseline below that (for example a Beta prior worth 50 games at the baseline).
  Label the shrinkage as heuristic. marvelsnap.pro win/loss counts (43 games in total) should never be shown.
- **Absence is weak evidence.** Because of the 20-game threshold, a card in zero lists (only `Redwing` here) or a
  pair never seen is "unpopular among tracked high-rank players", not "untested". 46% of the card pool sits under 1%
  of lists, so the app needs the power floor from mechanics, not from play data, for nearly half the cards.
- **Changing index.** Never persist `d` indexes; persist defIds. Never reuse a `d_map` from another response.
- **Archetypes.** Ids looked stable across the four timeframes but that was not tested over time. Keep the reviewed
  name mapping in `sync-data/` only for fixes (merging split families, renaming), keyed by archetype id and name.
- **Other modes.** Conquest, limited-time modes and Pool 1/2 buckets exist in the API (`…_conquest_v3` etc.) and were
  empty or tiny on the test day. Ranked `POOL3` buckets are the only ones with enough data.
- **Personal data.** Untapped responses contain none. marvelsnap.pro `getdecks` contains author nicknames: drop
  them at parse time.

## 6. Open questions

1. Untapped.gg terms of service: is unattended reading of the undocumented `/free` API acceptable for a local,
   single-user tool? robots.txt allows the site and the endpoints are anonymous, but that is not permission. The owner
   should read the terms or ask before this ships in a sync command. If the answer is no, there is no comparable
   fallback and the app would need manually imported lists.
2. Does `current_meta_period.id` change on every balance patch and OTA? Needs observation over a few weeks.
3. The exact free-tier transform of the cube value was not decoded. Cube rate matters more than win rate in Snap,
   so the app's "strength" evidence from this source is win rate only.
4. marvelsnap.pro `getmeta` and `getdecks` parameters (`timeFrame`, `rankScope`, `rq`) are untested; with them the
   fallback could be less thin.
5. The Kaggle dataset might hold historical lists; a person has to download it to find out.
6. The `ssrTierList` on the Untapped meta page uses a filter I could not identify (29,523 games); if the app wants to
   show Untapped's own tier number it has to be reverse-engineered or left out.
