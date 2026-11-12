import { clusterLists } from '@/engine/carddb';
import type { MetaArchetype, MetaInfo, MetaList } from '@/engine/types';
import { readSyncState, writeSyncState, type Db } from '@/server/db';
import type { Log } from './cards';
import { httpGet, type HttpOptions } from './http';

/**
 * Meta sync from Untapped's anonymous analytics JSON (docs/research/meta-sources.md §2.1, §4).
 * Decoding follows docs/research/analysis/meta/analyze-sample.mjs.
 */

export const API = 'https://api.snap.untapped.gg/api/v1';
export const CURRENT = 'CURRENT_META_PERIOD';
export const LAST_30_DAYS = 'EXACTLY_LAST_30_DAYS_NO_CURRENT_LOCATION';
/** Below this many lists (first days after a patch) a 30-day snapshot is fetched as well (meta §4 step 8). */
export const THIN_SNAPSHOT_LISTS = 1000;
/** At most one meta run per 6 hours (meta §4). */
export const MIN_INTERVAL_MS = 6 * 3600_000;
const MAX_REQUESTS = 12;
/** Pairs seen in fewer lists are not stored (meta §4); the in-memory index still counts them. */
const MIN_PAIR_LISTS = 5;

// ---- response shapes -------------------------------------------------------------------------

/** One list: `d` holds 12 indexes into the same response's `metadata.d_map`; other keys are collection-level buckets. */
export interface DeckRow { d?: unknown; [bucket: string]: unknown }
export interface DecksResponse { data?: DeckRow[]; metadata?: { d_map?: string[] } }
export interface ManifestEntry { arch_name?: string; card_popularity?: Record<string, number>; active?: boolean; [key: string]: unknown }
export type ArchetypeManifest = Record<string, ManifestEntry>;
/** data[archId][pool][rank] = [games, wins, cubes]; the cube value is scrambled in the free partition and is never read. */
export type ArchetypeStats = Record<string, Record<string, Record<string, unknown>>>;
/** data[defId][pool][rank] = { num_matches, winrate (percent), ... }; ranks Iron to Vibranium only. */
export type CardStatsResponse = { data?: Record<string, Record<string, Record<string, { num_matches?: number; winrate?: number }>>> };

export interface DecodedList { key: string; cards: string[]; archetypeId: number | null; altArchetypeId: number | null; games: number; wins: number }
export interface SnapshotList extends MetaList { altArchetypeId: number | null }

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const archId = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isInteger(n) ? n : null;
};

// ---- pure decoding ---------------------------------------------------------------------------

/**
 * Decodes a decks response with its own `d_map` (the index changes between responses and is
 * never persisted). A row needs 12 distinct indexes inside `d_map`; anything else is rejected
 * and reported, never silently dropped. Games and wins are summed over buckets and ranks. The
 * archetype is the `arch_id` of the buckets holding the most games.
 */
export function decodeDecks(response: DecksResponse): { lists: DecodedList[]; rejected: { row: number; reason: string }[] } {
  const rows = Array.isArray(response?.data) ? response.data : [];
  const dMap = Array.isArray(response?.metadata?.d_map) ? response.metadata.d_map : [];
  const lists: DecodedList[] = [];
  const rejected: { row: number; reason: string }[] = [];

  rows.forEach((row, at) => {
    const d = row?.d;
    if (!Array.isArray(d) || d.length !== 12) return void rejected.push({ row: at, reason: `expected 12 card indexes, got ${Array.isArray(d) ? d.length : 'none'}` });
    if (new Set(d).size !== 12) return void rejected.push({ row: at, reason: 'duplicate card index' });
    const cards: string[] = [];
    for (const i of d) {
      const id = Number.isInteger(i) ? dMap[i as number] : undefined;
      if (typeof id !== 'string' || !id) return void rejected.push({ row: at, reason: `index ${String(i)} is outside d_map` });
      cards.push(id);
    }
    if (new Set(cards).size !== 12) return void rejected.push({ row: at, reason: 'duplicate card after d_map lookup' });

    let games = 0;
    let wins = 0;
    const votes = new Map<number, number>();
    const altVotes = new Map<number, number>();
    for (const [bucket, value] of Object.entries(row)) {
      if (bucket === 'd' || typeof value !== 'object' || value === null) continue;
      let bucketGames = 0;
      for (const [rank, t] of Object.entries(value as Record<string, unknown>)) {
        if (rank === 'arch_id' || rank === 'alt_arch_id' || !Array.isArray(t)) continue;
        games += num(t[0]);
        wins += num(t[1]);
        bucketGames += num(t[0]);
      }
      const arch = archId((value as Record<string, unknown>).arch_id);
      const alt = archId((value as Record<string, unknown>).alt_arch_id);
      if (arch !== null) votes.set(arch, (votes.get(arch) ?? 0) + bucketGames);
      if (alt !== null) altVotes.set(alt, (altVotes.get(alt) ?? 0) + bucketGames);
    }
    const top = (m: Map<number, number>): number | null => [...m].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? null;
    cards.sort();
    lists.push({ key: cards.join('|'), cards, archetypeId: top(votes), altArchetypeId: top(altVotes), games, wins });
  });
  return { lists, rejected };
}

export interface SnapshotLabel { source: string; periodId: number | null; periodLabel: string | null; periodStart: string | null; fetchedAt: string }

/** Orders lists by games, merges exact duplicates, assigns near-duplicate clusters and totals. */
export function buildSnapshot(decoded: readonly DecodedList[], label: SnapshotLabel): { info: MetaInfo; lists: SnapshotList[]; wins: number } {
  const byKey = new Map<string, DecodedList>();
  for (const l of decoded) {
    const held = byKey.get(l.key);
    if (held) byKey.set(l.key, { ...held, games: held.games + l.games, wins: held.wins + l.wins, archetypeId: held.archetypeId ?? l.archetypeId, altArchetypeId: held.altArchetypeId ?? l.altArchetypeId });
    else byKey.set(l.key, l);
  }
  const ordered = [...byKey.values()].sort((a, b) => b.games - a.games || (a.key < b.key ? -1 : 1));
  const clusters = clusterLists(ordered);
  const lists: SnapshotList[] = ordered.map((l, i) => ({ ...l, cluster: clusters[i] }));
  const games = lists.reduce((s, l) => s + l.games, 0);
  const wins = lists.reduce((s, l) => s + l.wins, 0);
  const info: MetaInfo = {
    ...label,
    lists: lists.length,
    clusters: new Set(clusters).size,
    games,
    baselineWinRate: games > 0 ? wins / games : 0,
    minGamesPerList: lists.length > 0 ? Math.min(...lists.map((l) => l.games)) : 0,
  };
  return { info, lists, wins };
}

/** Number of cards kept in an archetype's `topCards`. */
const TOP_CARDS = 16;

/**
 * Archetypes present in the lists or in the stats query. Name and typical cards come from the
 * manifest (`card_popularity` = percent of the archetype's lists), games and wins from the stats
 * query (all ranks, no list threshold), the sample from the most-played list.
 */
export function buildArchetypes(lists: readonly MetaList[], manifest: ArchetypeManifest, stats: ArchetypeStats): MetaArchetype[] {
  const fromLists = new Map<number, { games: number; wins: number; sample: string[]; sampleGames: number; cards: Map<string, number> }>();
  for (const l of lists) {
    if (l.archetypeId === null) continue;
    const e = fromLists.get(l.archetypeId) ?? { games: 0, wins: 0, sample: [], sampleGames: -1, cards: new Map<string, number>() };
    e.games += l.games;
    e.wins += l.wins;
    if (l.games > e.sampleGames) {
      e.sample = [...l.cards];
      e.sampleGames = l.games;
    }
    for (const c of l.cards) e.cards.set(c, (e.cards.get(c) ?? 0) + 1);
    fromLists.set(l.archetypeId, e);
  }

  const fromStats = new Map<number, { games: number; wins: number }>();
  for (const [key, pools] of Object.entries(stats ?? {})) {
    const id = archId(key);
    if (id === null || typeof pools !== 'object' || pools === null) continue;
    let games = 0;
    let wins = 0;
    for (const ranks of Object.values(pools)) {
      if (typeof ranks !== 'object' || ranks === null) continue;
      for (const t of Object.values(ranks)) {
        if (!Array.isArray(t)) continue;
        games += num(t[0]);
        wins += num(t[1]);
      }
    }
    fromStats.set(id, { games, wins });
  }

  const ids = [...new Set([...fromLists.keys(), ...[...fromStats].filter(([, s]) => s.games > 0).map(([id]) => id)])];
  const rows = ids.map((id) => {
    const inLists = fromLists.get(id);
    const total = fromStats.get(id) ?? { games: inLists?.games ?? 0, wins: inLists?.wins ?? 0 };
    const entry = manifest?.[String(id)];
    const popular = Object.entries(entry?.card_popularity ?? {}).filter(([, pct]) => typeof pct === 'number');
    const ranked = popular.length > 0 ? popular : [...(inLists?.cards ?? [])];
    const topCards = ranked.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, TOP_CARDS).map(([card]) => card);
    return {
      id, name: typeof entry?.arch_name === 'string' && entry.arch_name ? entry.arch_name : `Archetype ${id}`,
      games: total.games, wins: total.wins, share: 0, topCards, sample: inLists?.sample ?? [], planId: null,
    } satisfies MetaArchetype;
  });
  const all = rows.reduce((s, r) => s + r.games, 0);
  for (const r of rows) r.share = all > 0 ? r.games / all : 0;
  return rows.sort((a, b) => b.games - a.games || a.id - b.id);
}

/** Low-rank card stats (Iron to Vibranium, 24% of games: meta §3 bias note 4), pooled per card. */
export function decodeCardStats(response: CardStatsResponse): Map<string, { matches: number; winRate: number | null }> {
  const out = new Map<string, { matches: number; winRate: number | null }>();
  for (const [defId, pools] of Object.entries(response?.data ?? {})) {
    let matches = 0;
    let wins = 0;
    for (const ranks of Object.values(pools ?? {})) {
      for (const s of Object.values(ranks ?? {})) {
        const m = num(s?.num_matches);
        matches += m;
        wins += (m * num(s?.winrate)) / 100;
      }
    }
    out.set(defId, { matches, winRate: matches > 0 ? wins / matches : null });
  }
  return out;
}

// ---- storage -----------------------------------------------------------------------------------

export interface StoredSnapshot {
  id: string; timeframe: string; season: string | null; etag: string | null; lastModified: string | null;
  info: MetaInfo; lists: SnapshotList[]; wins: number; archetypes: MetaArchetype[];
  lowRank: Map<string, { matches: number; winRate: number | null }>;
}

/** Writes one snapshot, replacing any earlier one of the same timeframe and meta period. */
export function storeSnapshot(db: Db, s: StoredSnapshot): { pairs: number } {
  let pairCount = 0;
  db.transaction(() => {
    const old = db.prepare('SELECT id FROM meta_snapshots WHERE timeframe = ? AND period_id IS ?').all(s.timeframe, s.info.periodId) as { id: string }[];
    for (const { id } of [...old, { id: s.id }]) {
      for (const table of ['meta_lists', 'meta_archetypes', 'meta_card_stats', 'meta_pairs']) db.prepare(`DELETE FROM ${table} WHERE snapshot = ?`).run(id);
      db.prepare('DELETE FROM meta_snapshots WHERE id = ?').run(id);
    }
    db.prepare(
      'INSERT INTO meta_snapshots(id, source, timeframe, period_id, period_label, period_start, season, fetched_at, etag, last_modified, lists, clusters, games, wins, min_games, json) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      s.id, s.info.source, s.timeframe, s.info.periodId, s.info.periodLabel, s.info.periodStart, s.season, s.info.fetchedAt, s.etag, s.lastModified,
      s.info.lists, s.info.clusters, s.info.games, s.wins, s.info.minGamesPerList, JSON.stringify(s.info),
    );

    const addList = db.prepare('INSERT INTO meta_lists(snapshot, list_key, cards, archetype, alt_archetype, games, wins, cluster) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    const cardTotals = new Map<string, { lists: number; games: number; wins: number }>();
    const pairs = new Map<string, { lists: number; clusters: Set<number> }>();
    for (const l of s.lists) {
      addList.run(s.id, l.key, JSON.stringify(l.cards), l.archetypeId, l.altArchetypeId, l.games, l.wins, l.cluster);
      for (let i = 0; i < l.cards.length; i++) {
        const t = cardTotals.get(l.cards[i]) ?? { lists: 0, games: 0, wins: 0 };
        t.lists += 1;
        t.games += l.games;
        t.wins += l.wins;
        cardTotals.set(l.cards[i], t);
        for (let j = i + 1; j < l.cards.length; j++) {
          const key = `${l.cards[i]}|${l.cards[j]}`;   // cards are sorted, so a < b
          const p = pairs.get(key);
          if (p) {
            p.lists += 1;
            p.clusters.add(l.cluster);
          } else {
            pairs.set(key, { lists: 1, clusters: new Set([l.cluster]) });
          }
        }
      }
    }

    const addArch = db.prepare('INSERT INTO meta_archetypes(snapshot, id, name, games, wins, json) VALUES (?, ?, ?, ?, ?, ?)');
    for (const a of s.archetypes) addArch.run(s.id, a.id, a.name, a.games, a.wins, JSON.stringify(a));

    const addStat = db.prepare('INSERT INTO meta_card_stats(snapshot, def_id, lists, games, wins, low_rank_matches, low_rank_win_rate) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const defId of new Set([...cardTotals.keys(), ...s.lowRank.keys()])) {
      const t = cardTotals.get(defId) ?? { lists: 0, games: 0, wins: 0 };
      const low = s.lowRank.get(defId);
      addStat.run(s.id, defId, t.lists, t.games, t.wins, low?.matches ?? null, low?.winRate ?? null);
    }

    const addPair = db.prepare('INSERT INTO meta_pairs(snapshot, a, b, lists, clusters) VALUES (?, ?, ?, ?, ?)');
    for (const [key, p] of pairs) {
      if (p.lists < MIN_PAIR_LISTS) continue;
      const [a, b] = key.split('|');
      addPair.run(s.id, a, b, p.lists, p.clusters.size);
      pairCount += 1;
    }
  })();
  return { pairs: pairCount };
}

// ---- sync --------------------------------------------------------------------------------------

interface FilterManifest {
  current_meta_period?: { id?: number; start_ts?: string; description?: string; data_volume?: { min?: { num_games?: number; num_decks?: number } } };
  [key: string]: unknown;
}

export interface MetaOptions { force?: boolean; http?: HttpOptions; now?: number }

export async function syncMeta(db: Db, log: Log, opts: MetaOptions = {}): Promise<void> {
  const now = opts.now ?? Date.now();
  const last = readSyncState(db, 'meta');
  if (last && !opts.force) {
    const age = now - Date.parse(last.finishedAt);
    if (Number.isFinite(age) && age >= 0 && age < MIN_INTERVAL_MS) {
      log(`meta skipped: last run was ${(age / 3600_000).toFixed(1)} h ago and the source is read at most once per 6 h (use --force to override)`);
      return;
    }
  }

  let requests = 0;
  const get = async <T>(path: string, etag?: string | null): Promise<{ status: number; data: T | null; etag: string | null; lastModified: string | null }> => {
    if (++requests > MAX_REQUESTS) throw new Error('meta: request cap reached');
    const url = `${API}/${path}`;
    const res = await httpGet(url, { accept: 'application/json', ...opts.http, headers: etag ? { 'If-None-Match': etag } : undefined });
    if (res.status === 304) {
      await res.body?.cancel().catch(() => undefined);
      return { status: 304, data: null, etag: res.headers.get('etag') ?? etag ?? null, lastModified: res.headers.get('last-modified') };
    }
    const body = await res.text();
    // 202 with an empty body means "query not materialised yet" (seen in research for the hot location).
    if (res.status !== 200 || !body.trim()) throw new Error(`meta: GET ${url} -> HTTP ${res.status}${body.trim() ? '' : ' (empty body)'}; keeping the stored snapshot`);
    return { status: 200, data: JSON.parse(body) as T, etag: res.headers.get('etag'), lastModified: res.headers.get('last-modified') };
  };

  const filter = (await get<FilterManifest>('filter-manifest')).data ?? {};
  const period = filter.current_meta_period ?? {};
  const season = ((await get<{ current_season?: string }>('analytics/query/current_season')).data ?? {}).current_season ?? null;
  const manifest = ((await get<{ data?: ArchetypeManifest }>('analytics/query/archetypes_manifest_v3')).data ?? {}).data ?? {};
  const known = new Set((db.prepare('SELECT def_id FROM cards').all() as { def_id: string }[]).map((r) => r.def_id));
  const fetchedAt = new Date(now).toISOString();

  const fetchTimeframe = async (timeframe: string, current: boolean): Promise<StoredSnapshot | null> => {
    const periodId = current && typeof period.id === 'number' ? period.id : null;
    const prev = db.prepare('SELECT id, etag, lists, period_id AS periodId FROM meta_snapshots WHERE timeframe = ? ORDER BY fetched_at DESC LIMIT 1').get(timeframe) as
      | { id: string; etag: string | null; lists: number; periodId: number | null }
      | undefined;
    const q = `TimestampRangeFilter=${timeframe}`;
    const decks = await get<DecksResponse>(`analytics/query/decks_stats_by_pool_v4/free?${q}`, prev && prev.periodId === periodId ? prev.etag : null);
    if (decks.status === 304 || !decks.data) {
      log(`meta ${timeframe}: not modified since the stored snapshot`);
      return null;
    }
    const { lists: decoded, rejected } = decodeDecks(decks.data);
    const rowCount = Array.isArray(decks.data.data) ? decks.data.data.length : 0;
    for (const r of rejected.slice(0, 10)) log(`meta ${timeframe}: rejected row ${r.row}: ${r.reason}`);
    if (decoded.length === 0) throw new Error(`meta ${timeframe}: no valid lists in the response; keeping the stored snapshot`);
    if (rejected.length > rowCount * 0.02) throw new Error(`meta ${timeframe}: ${rejected.length} of ${rowCount} rows are invalid; keeping the stored snapshot`);

    const built = buildSnapshot(decoded, {
      source: `untapped:${timeframe}`, periodId,
      periodLabel: current ? period.description ?? null : 'Last 30 days (previous patches included)',
      periodStart: current ? period.start_ts ?? null : null, fetchedAt,
    });
    if (prev && prev.periodId === periodId && (built.lists.length < prev.lists / 5 || built.lists.length > prev.lists * 5)) {
      throw new Error(`meta ${timeframe}: ${built.lists.length} lists against ${prev.lists} before; keeping the stored snapshot`);
    }
    const volume = current ? period.data_volume?.min : undefined;
    if (volume && typeof volume.num_decks === 'number' && typeof volume.num_games === 'number') {
      const same = volume.num_decks === rowCount && volume.num_games === built.info.games;
      log(`meta ${timeframe}: filter-manifest says ${volume.num_decks} lists / ${volume.num_games} games; parsed ${rowCount} / ${built.info.games}${same ? ' (equal)' : ' (differs: the files are regenerated at different times)'}`);
      if (Math.abs(volume.num_decks - rowCount) > 0.2 * Math.max(volume.num_decks, rowCount)) {
        throw new Error(`meta ${timeframe}: list count is more than 20% away from the manifest; keeping the stored snapshot`);
      }
    }
    const unknown = [...new Set(built.lists.flatMap((l) => l.cards))].filter((c) => known.size > 0 && !known.has(c));
    if (unknown.length > 0) log(`meta ${timeframe}: ${unknown.length} card ids are not in the card table (lists kept): ${unknown.slice(0, 20).join(', ')}`);

    const stats = ((await get<{ data?: ArchetypeStats }>(`analytics/query/archetypes_by_pool_v4/free?${q}`)).data ?? {}).data ?? {};
    const cardStats = (await get<CardStatsResponse>(`analytics/query/card_stats_by_pool_v2/free?${q}`)).data ?? {};
    return {
      id: `untapped:${timeframe}:${periodId ?? 'none'}:${fetchedAt}`, timeframe, season, etag: decks.etag, lastModified: decks.lastModified,
      info: built.info, lists: built.lists, wins: built.wins,
      archetypes: buildArchetypes(built.lists, manifest, stats), lowRank: decodeCardStats(cardStats),
    };
  };

  const summary: Record<string, unknown> = { periodId: period.id ?? null, periodLabel: period.description ?? null, season };
  const current = await fetchTimeframe(CURRENT, true);
  let listCount = current?.info.lists ?? null;
  if (current) {
    const { pairs } = storeSnapshot(db, current);
    Object.assign(summary, {
      lists: current.info.lists, clusters: current.info.clusters, games: current.info.games,
      baselineWinRate: Number(current.info.baselineWinRate.toFixed(4)), minGamesPerList: current.info.minGamesPerList,
      archetypes: current.archetypes.length, labelledLists: current.lists.filter((l) => l.archetypeId !== null).length, pairsStored: pairs,
    });
  } else {
    const row = db.prepare('SELECT lists FROM meta_snapshots WHERE timeframe = ? ORDER BY fetched_at DESC LIMIT 1').get(CURRENT) as { lists: number } | undefined;
    listCount = row?.lists ?? null;
    summary.unchanged = true;
  }
  if (listCount !== null && listCount < THIN_SNAPSHOT_LISTS) {
    log(`meta: the current period has ${listCount} lists (under ${THIN_SNAPSHOT_LISTS}); adding a 30-day snapshot`);
    const wide = await fetchTimeframe(LAST_30_DAYS, false);
    if (wide) {
      storeSnapshot(db, wide);
      summary.last30Days = { lists: wide.info.lists, clusters: wide.info.clusters, games: wide.info.games };
    }
  }
  summary.requests = requests;
  writeSyncState(db, 'meta', summary, now);
  log(`meta finished ${JSON.stringify(summary)}`);
}
