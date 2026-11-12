/**
 * Energy model (spec §9; docs/research/deck-theory-and-creativity.md §1.3). Provenance: derived from a
 * model. A seeded Monte Carlo of the greedy policy of the research script `analysis/theory/draw_odds.py`
 * part C: each turn play the cards that spend the most energy, fewest cards on a tie, without looking
 * ahead. Rules (theory §1.1): 3-card opening hand, one draw per turn including turn 1 (none at the hand
 * limit of 7), energy on turn t is t, 6 turns, unspent energy is lost.
 *
 * What the model adds over printed costs (HEURISTIC, read from the card's features):
 *  - `model.selfDiscount` lowers the card's own cost ("Costs 1 less for each ..." counts once);
 *  - `model.extraEnergy` adds energy after the card is played: on every later turn when the card
 *    raises Max Energy (trait `energy_max_player`), else on the next turn only. Conditions on the
 *    gain (Wiccan's "if you've spent all your Energy") are ignored.
 *  - 0-cost cards are always played (they cost nothing); the greedy key alone would never play them.
 * Not modelled: board space, cost changes from other cards, generated cards, holding cards on purpose,
 * cards shuffled into the deck. Results are cached by the deck's cost signature.
 */
import type { CardDb, Deck, EnergyReport } from '../types';
import { mulberry32, shuffleInPlace } from './rng';

export const TURNS = 6;
export const TOTAL_ENERGY = 21;
const HAND_LIMIT = 7;
const OPENING = 3;
const DEFAULT_GAMES = 4000;
const DEFAULT_SEED = 20261113;

interface SimCard { cost: number; maxGain: number; nextGain: number; sig: string }

function simCards(deck: Deck, db: CardDb): { card: SimCard; defId: string; printed: number }[] {
  const out: { card: SimCard; defId: string; printed: number }[] = [];
  const seen = new Set<string>();
  for (const dc of deck.cards) {
    if (seen.has(dc.defId)) continue;
    seen.add(dc.defId);
    const c = db.get(dc.defId);
    if (!c) continue;                                    // a card that left the pool: not drawn
    const f = db.features(c.defId);
    const discount = Math.max(0, f?.model.selfDiscount ?? 0);
    const gain = f?.model.extraEnergy ?? 0;
    const permanent = f?.traits.includes('energy_max_player') ?? false;
    const cost = Math.max(0, c.cost - discount);
    const maxGain = permanent ? gain : 0;
    const nextGain = permanent ? 0 : gain;
    out.push({ card: { cost, maxGain, nextGain, sig: `${cost}/${maxGain}/${nextGain}` }, defId: c.defId, printed: c.cost });
  }
  return out;
}

/** The deck's cost signature: the sorted per-card (cost, energy gain) tuples the simulation depends on. */
export function energySignature(deck: Deck, db: CardDb): string {
  return simCards(deck, db).map((x) => x.card.sig).sort().join(',');
}

interface SimResult { spent: number; noPlay: number[]; likely: string[][] }

/** Best play this turn: max energy spent, then fewest cards, then the most expensive cards first. */
function bestPlay(hand: SimCard[], energy: number): number[] {
  const free: number[] = [];
  const paid: number[] = [];
  hand.forEach((c, i) => (c.cost === 0 ? free : paid).push(i));
  let best = 0;
  let bestSum = 0;
  let bestLen = 0;
  let bestKey = '';
  const m = paid.length;
  for (let mask = 1; mask < 1 << m; mask++) {
    let sum = 0;
    let len = 0;
    const costs: number[] = [];
    for (let j = 0; j < m; j++) {
      if (mask & (1 << j)) {
        const c = hand[paid[j]!]!.cost;
        sum += c;
        len++;
        costs.push(c);
      }
    }
    if (sum > energy) continue;
    const key = costs.sort((x, y) => y - x).map((x) => String(x).padStart(2, '0')).join('');
    if (sum > bestSum || (sum === bestSum && (len < bestLen || (len === bestLen && key > bestKey)))) {
      best = mask;
      bestSum = sum;
      bestLen = len;
      bestKey = key;
    }
  }
  const chosen = [...free];
  for (let j = 0; j < m; j++) if (best & (1 << j)) chosen.push(paid[j]!);
  return chosen;
}

function simulate(cards: SimCard[], seed: number, games: number): SimResult {
  const rnd = mulberry32(seed);
  let spentTotal = 0;
  const noPlay = new Array<number>(TURNS + 1).fill(0);
  const combos: Map<string, number>[] = Array.from({ length: TURNS + 1 }, () => new Map());
  for (let g = 0; g < games; g++) {
    const order = shuffleInPlace([...cards], rnd);
    const hand = order.slice(0, OPENING);
    let ptr = Math.min(OPENING, order.length);
    let maxBonus = 0;
    let nextBonus = 0;
    for (let t = 1; t <= TURNS; t++) {
      if (hand.length < HAND_LIMIT && ptr < order.length) hand.push(order[ptr++]!);
      const energy = Math.max(0, t + maxBonus + nextBonus);
      nextBonus = 0;
      const play = bestPlay(hand, energy);
      if (play.length === 0) {
        noPlay[t]!++;
        continue;
      }
      const played = play.map((i) => hand[i]!);
      for (const i of [...play].sort((x, y) => y - x)) hand.splice(i, 1);
      for (const c of played) {
        spentTotal += c.cost;
        maxBonus += c.maxGain;
        nextBonus += c.nextGain;
      }
      const key = played.map((c) => c.sig).sort().join('+');
      combos[t]!.set(key, (combos[t]!.get(key) ?? 0) + 1);
    }
  }
  const likely: string[][] = combos.map((m) => {
    let bestKey = '';
    let bestN = 0;
    for (const [k, n] of [...m].sort((x, y) => (x[0] < y[0] ? -1 : 1))) if (n > bestN) [bestKey, bestN] = [k, n];
    return bestKey ? bestKey.split('+') : [];
  });
  return { spent: games ? spentTotal / games : 0, noPlay: noPlay.map((n) => (games ? n / games : 1)), likely };
}

const cache = new Map<string, SimResult>();
const CACHE_LIMIT = 500;

/**
 * Expected energy spent of 21, P(no play) per turn, the most likely play per turn (the deck's cards
 * whose cost signature makes up the most frequent play; cards with equal signatures are interchangeable,
 * so all of them are listed), the curve at printed costs 0..7+ and the average printed cost.
 * Arrays indexed by turn have index 0 unused (0 / []).
 */
export function energyModel(deck: Deck, db: CardDb, seed: number = DEFAULT_SEED, games: number = DEFAULT_GAMES): EnergyReport {
  const entries = simCards(deck, db);
  const curve = new Array<number>(8).fill(0);
  for (const e of entries) curve[Math.min(7, Math.max(0, e.printed))]!++;
  const avgCost = entries.length ? entries.reduce((s, e) => s + e.printed, 0) / entries.length : 0;
  const n = Math.max(0, Math.floor(games));
  const sigs = entries.map((e) => e.card).sort((x, y) => (x.sig < y.sig ? -1 : x.sig > y.sig ? 1 : 0));
  const key = `${sigs.map((c) => c.sig).join(',')}#${seed}#${n}`;
  let sim = cache.get(key);
  if (!sim) {
    sim = simulate(sigs, seed, n);
    if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!);
    cache.set(key, sim);
  }
  const likelyPlays = sim.likely.map((sigList, t) => {
    if (t === 0) return [];
    const want = new Set(sigList);
    return entries.filter((e) => want.has(e.card.sig)).map((e) => e.defId).sort();
  });
  const pNoPlay = sim.noPlay.map((p, t) => (t === 0 ? 0 : p));
  return { expectedSpent: sim.spent, pNoPlay, likelyPlays, curve, avgCost };
}
