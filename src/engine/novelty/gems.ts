/**
 * Hidden gems (spec §13; docs/research/deck-theory-and-creativity.md §4.4):
 *
 *   Gem(a, b)   = 100 x s_ab x U_ab x sqrt(q_a x q_b)          q = card quality / 100 (heuristic)
 *   Gem(a, b, c) = 100 x s_abc x U_abc x cbrt(q_a q_b q_c) x 0.70
 *
 * over every strong edge of released cards. Triples come from two strong edges sharing a card; s_abc is
 * the weakest of the three pair scores, so the third pair must also have a positive edge (theory §4.4;
 * the "dedicated enabler + payoff + amplifier pattern" alternative is not implemented). U is counted
 * over clusters of near-duplicate lists (clusters.ts). A smoothed lift under 0.5 with expected co-play
 * of 5 or more is kept with a warning, not hidden. All weights are HEURISTIC; the counts are measured.
 */
import { gateFor } from '../rules/validate';
import type { CardDb, CardEdge, Deck, EngineContext, Gem } from '../types';
import { coplay, corpusOf } from './clusters';
import { deckIds } from './novelty';

/** Triple discount (theory §4.4: 38.2% / 54.5% assembly odds of three pieces against two). */
export const TRIPLE_DISCOUNT = 0.7;
const DEFAULT_LIMIT = 50;

const gemCache = new WeakMap<CardDb, Gem[]>();

const q = (db: CardDb, id: string): number => Math.max(0, Math.min(1, (db.features(id)?.quality ?? 50) / 100));
const nameOf = (db: CardDb, id: string): string => db.get(id)?.name ?? id;
const bestLabel = (e: CardEdge | undefined): string => {
  const r = e?.reasons.filter((x) => x.kind === 'synergy').sort((x, y) => y.value - x.value)[0];
  return r ? r.label : 'interaction';
};

function compute(db: CardDb): Gem[] {
  const corpus = corpusOf(db);
  const released = new Set(db.released().map((c) => c.defId));
  const strong: CardEdge[] = [];
  const byCard = new Map<string, CardEdge[]>();
  for (const id of released) {
    for (const e of db.edges(id)) {
      if (!e.strong || e.a !== id || e.a === e.b || !released.has(e.b)) continue;
      strong.push(e);
      for (const x of [e.a, e.b]) {
        const l = byCard.get(x);
        if (l) l.push(e);
        else byCard.set(x, [e]);
      }
    }
  }
  const gems: Gem[] = [];
  for (const e of strong) {
    const ev = coplay(corpus, [e.a, e.b]);
    const s = Math.min(1, e.score);
    gems.push({
      cards: [e.a, e.b],
      gem: 100 * s * ev.unexplored * Math.sqrt(q(db, e.a) * q(db, e.b)),
      strength: s,
      unexplored: ev.unexplored,
      reason: `${nameOf(db, e.a)} + ${nameOf(db, e.b)}: ${bestLabel(e)}`,
      observed: ev.observed,
      expected: ev.expected,
      warning: ev.warning,
    });
  }
  const seen = new Set<string>();
  for (const [hub, list] of byCard) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const x = list[i]!.a === hub ? list[i]!.b : list[i]!.a;
        const y = list[j]!.a === hub ? list[j]!.b : list[j]!.a;
        const third = db.edge(x, y);
        if (!third || third.score <= 0) continue;
        const cards = [hub, x, y].sort();
        const key = cards.join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        const s = Math.min(1, list[i]!.score, list[j]!.score, third.score);
        const ev = coplay(corpus, cards);
        gems.push({
          cards,
          gem: 100 * s * ev.unexplored * Math.cbrt(q(db, cards[0]!) * q(db, cards[1]!) * q(db, cards[2]!)) * TRIPLE_DISCOUNT,
          strength: s,
          unexplored: ev.unexplored,
          reason: `${nameOf(db, hub)} + ${nameOf(db, x)}: ${bestLabel(list[i])}; ${nameOf(db, hub)} + ${nameOf(db, y)}: ${bestLabel(list[j])}; ${nameOf(db, x)} + ${nameOf(db, y)}: ${bestLabel(third)} (three pieces, x${TRIPLE_DISCOUNT})`,
          observed: ev.observed,
          expected: ev.expected,
          warning: ev.warning,
        });
      }
    }
  }
  gems.sort((a, b) => b.gem - a.gem || b.strength - a.strength || a.cards.length - b.cards.length || (a.cards.join('|') < b.cards.join('|') ? -1 : 1));
  return gems;
}

/** All gems of the database (strong pairs and triples), best first. Computed once per database. */
export function gemsFor(db: CardDb, limit: number = DEFAULT_LIMIT): Gem[] {
  let all = gemCache.get(db);
  if (!all) gemCache.set(db, (all = compute(db)));
  return all.slice(0, Math.max(0, Math.floor(limit)));
}

/**
 * Gems the deck completes with one more card: every card but one is in the deck, and the missing one
 * passes the add gates (released, deckable, not banned, owned when owned-only). Best first.
 */
export function gemsNear(deck: Deck, ctx: EngineContext, limit: number = 10): Gem[] {
  const db = ctx.db;
  const ids = new Set(deckIds(deck, db));
  if (ids.size === 0) return [];
  gemsFor(db, 0);
  const all = gemCache.get(db)!;
  const out: Gem[] = [];
  for (const g of all) {
    if (out.length >= limit) break;
    const missing = g.cards.filter((c) => !ids.has(c));
    if (missing.length !== 1) continue;
    const card = db.get(missing[0]!);
    if (!card || gateFor(card, deck, db, ctx.owned)) continue;
    out.push(g);
  }
  return out;
}
