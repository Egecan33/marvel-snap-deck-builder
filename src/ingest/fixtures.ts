/**
 * Writes the committed test fixtures from the synced database:
 *   tests/fixtures/cards.json   every released and upcoming card row, the tokens they create,
 *                               and 20 non-deckable rows that share a display name with a released card
 *   tests/fixtures/meta.json    the 300 most-played lists, their archetypes, snapshot info
 *   tests/fixtures/decks/*.txt  the most-played list of six different archetypes
 * Run after `pnpm sync cards meta`:  pnpm tsx src/ingest/fixtures.ts
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { classOf, clusterLists, normalizeName, toCard, type UntappedCardRow } from '@/engine/carddb';
import type { MetaArchetype, MetaInfo, MetaList } from '@/engine/types';
import { loadMetaIndex } from '@/server/carddb';
import { openDb, readSyncState } from '@/server/db';

const FIXTURES = path.join(process.cwd(), 'tests', 'fixtures');
const LISTS = 300;
const COLLIDERS = 20;
const DECKS = 6;

/** Short deck code (data §4.1): defId without lower-case aeiouy plus its length in upper-case hex. */
const shortCode = (defIds: readonly string[]): string =>
  Buffer.from(defIds.map((id) => id.replace(/[aeiouy]/g, '') + id.length.toString(16).toUpperCase()).join(','), 'utf8').toString('base64');

const slug = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'deck';

function main(): void {
  const db = openDb();
  const now = Date.now();
  try {
    const rows = (db.prepare('SELECT json FROM cards ORDER BY def_id').all() as { json: string }[]).map((r) => JSON.parse(r.json) as UntappedCardRow);
    if (rows.length === 0) throw new Error('no cards in the database; run `pnpm sync cards meta` first');
    const byId = new Map(rows.map((r) => [r.defId, r]));
    const released = rows.filter((r) => classOf(r, now) === 'released');
    const upcoming = rows.filter((r) => classOf(r, now) === 'upcoming');

    // Tokens the deckable cards create, followed transitively.
    const keep = new Set([...released, ...upcoming].map((r) => r.defId));
    const queue = [...keep];
    let tokenCount = 0;
    while (queue.length > 0) {
      const links = byId.get(queue.pop()!)?.attributes?.cards ?? {};
      for (const id of [...(links.Card_Token ?? []), ...(links.Hidden_Card_Token ?? [])]) {
        if (!byId.has(id) || keep.has(id)) continue;
        keep.add(id);
        queue.push(id);
        tokenCount += 1;
      }
    }

    // Non-deckable rows sharing a normalised display name with a released card, spread over as many names as possible.
    const releasedNames = new Set(released.map((r) => normalizeName(String(r.name))));
    const groups = new Map<string, UntappedCardRow[]>();
    for (const r of rows) {
      const key = normalizeName(String(r.name));
      if (classOf(r, now) === 'released' || !releasedNames.has(key)) continue;
      groups.set(key, [...(groups.get(key) ?? []), r]);
    }
    const colliders: string[] = [];
    for (let round = 0; colliders.length < COLLIDERS && round < 20; round++) {
      for (const key of [...groups.keys()].sort()) {
        const r = groups.get(key)![round];
        if (r && colliders.length < COLLIDERS) colliders.push(r.defId);
      }
    }
    const collidersAdded = colliders.filter((id) => !keep.has(id)).length;
    for (const id of colliders) keep.add(id);

    const out = rows.filter((r) => keep.has(r.defId)).map(({ artists: _artists, ...rest }) => rest);
    const build = (readSyncState(db, 'cards')?.info.build as string | null | undefined) ?? null;
    mkdirSync(path.join(FIXTURES, 'decks'), { recursive: true });
    writeFileSync(
      path.join(FIXTURES, 'cards.json'),
      `{"capturedAt":${now},"build":${JSON.stringify(build)},"colliders":${JSON.stringify(colliders.sort())},"cards":[\n${out.map((r) => JSON.stringify(r)).join(',\n')}\n]}\n`,
    );
    console.log(`cards.json: ${out.length} rows (${released.length} released, ${upcoming.length} upcoming, ${tokenCount} tokens, ${collidersAdded} more name colliders of ${colliders.length})`);

    const index = loadMetaIndex(db);
    const full = index.info();
    if (!full) throw new Error('no meta snapshot in the database; run `pnpm sync meta` first');
    const top = index.lists().slice(0, LISTS);
    const clusters = clusterLists(top);
    const lists: MetaList[] = top.map((l, i) => ({ ...l, cluster: clusters[i] }));
    const games = lists.reduce((s, l) => s + l.games, 0);
    const wins = lists.reduce((s, l) => s + l.wins, 0);
    const info: MetaInfo = {
      ...full,
      source: `${full.source} (fixture: ${lists.length} most-played lists)`,
      lists: lists.length, clusters: new Set(clusters).size, games,
      baselineWinRate: games > 0 ? wins / games : 0,
      minGamesPerList: lists.length > 0 ? Math.min(...lists.map((l) => l.games)) : 0,
    };
    const used = new Set(lists.map((l) => l.archetypeId));
    const archetypes: MetaArchetype[] = index.archetypes().filter((a) => used.has(a.id));
    writeFileSync(
      path.join(FIXTURES, 'meta.json'),
      `{"info":${JSON.stringify(info)},\n"fullSnapshot":${JSON.stringify(full)},\n"archetypes":[\n${archetypes.map((a) => JSON.stringify(a)).join(',\n')}\n],\n"lists":[\n${lists.map((l) => JSON.stringify(l)).join(',\n')}\n]}\n`,
    );
    console.log(`meta.json: ${lists.length} lists, ${info.clusters} clusters, ${games} games, ${archetypes.length} archetypes (snapshot: ${full.lists} lists, ${full.games} games)`);

    for (const f of readdirSync(path.join(FIXTURES, 'decks'))) if (f.endsWith('.txt')) rmSync(path.join(FIXTURES, 'decks', f));
    const names = new Map(index.archetypes().map((a) => [a.id, a.name]));
    const seen = new Set<number>();
    const files = new Set<string>();
    for (const l of lists) {
      if (seen.size >= DECKS) break;
      if (l.archetypeId === null || seen.has(l.archetypeId)) continue;
      const cards = l.cards.map((id) => byId.get(id)).filter((r): r is UntappedCardRow => r !== undefined).map((r) => toCard(r, now));
      if (cards.length !== 12 || cards.some((c) => c.cardClass !== 'released')) continue;
      seen.add(l.archetypeId);
      cards.sort((a, b) => a.cost - b.cost || a.name.localeCompare(b.name, 'en'));
      const archetype = names.get(l.archetypeId) ?? `Archetype ${l.archetypeId}`;
      let file = slug(archetype);
      if (files.has(file)) file = `${file}-${l.archetypeId}`;
      files.add(file);
      const text = [
        ...cards.map((c) => `# (${c.cost}) ${c.name}`),
        '#',
        shortCode(cards.map((c) => c.defId)),
        '#',
        `# Snap Forge test fixture: most-played "${archetype}" list (Untapped archetype ${l.archetypeId}), ${l.games} games, meta period ${full.periodId ?? 'unknown'}`,
        '',
      ].join('\n');
      writeFileSync(path.join(FIXTURES, 'decks', `${file}.txt`), text);
      console.log(`decks/${file}.txt: ${archetype}, ${l.games} games`);
    }
  } finally {
    db.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
