/**
 * Power floor (spec §14; docs/research/deck-theory-and-creativity.md §4.5 C1-C8, §4.8): the hard
 * filter on every deck the builder returns. Each check reports its value, threshold and status.
 *
 * C1 legality and C5's partner count are rules; C2-C3 come from the derived energy model; C4, C6-C8
 * read the HEURISTIC plan catalogue and interaction network. Every threshold below is HEURISTIC and
 * was RE-TUNED on 2026-11-13 against the known-good / known-bad test of theory §4.8
 * (tests/engine/builder.test.ts): the 200 most-played fixture lists against 50 seeded random piles.
 *
 * Why the research defaults could not be kept (measured on those 200 lists): the network finds a
 * median of 1 strong pair per meta list (research C6 asks for 10, 29 of 200 lists reach it), 10 of 12
 * cards without a strong edge (C6 allows 2), 7 off-plan cards (C8 allows 3) and no primary plan at
 * all in more than 10% of lists (C4 asks for 80% assembly; 98 of 200 reach it). With the research
 * values only 14 of 200 lists passed (7%). The strong-edge recall of the network (HANDOVER, Task 5)
 * and the plan families missing from plans.json (Task 6) are the cause, not the lists. The re-tuned
 * values below are the tightest found that still fail every random pile (random piles never have more
 * than 2 strong pairs); see docs/HANDOVER.md "After Task 8" for the pass rates they reach.
 */
import { energyModel } from '../maths/energy';
import { deckIds } from '../novelty/novelty';
import { detectPlans } from '../plans/detect';
import { ENERGY, SYNERGY } from '../rating/constants';
import { pairStats, names, nameOf } from '../rating/deck';
import { isLegal, validateDeck } from '../rules/validate';
import type { CardDb, Deck, EngineContext, FloorCheck, FloorReport } from '../types';

/** Floor thresholds (HEURISTIC; research default in each comment). */
export const FLOOR: Record<string, number> = {
  /** C2: modelled energy spent of 21, at least (research 18.0; measured, kept). */
  energySpent: 18.0,
  /** C3: P(no play on turn 3), at most (research 10% from 15 lists; 28 of the 200 fixture lists exceed it). */
  noPlayT3: 0.15,
  /** C4: primary plan assembly by its key turn, at least (research 80%; here the plan threshold of spec §10). */
  planAssembly: 0.6,
  /** C4/C6 alternative: pairs scoring at least `linkedEdge` that stand in for a plan family the catalogue lacks. */
  linkedPairsAlt: 19,
  /** A pair at or above this score links two cards (rating SYNERGY.weakEdge). */
  linkedEdge: 0.2,
  /** C6: strong pairs of 66, at least (research 10). */
  strongPairs: 2,
  /** C6: cards with no pair of `linkedEdge` or more, at most (research: at most 2 cards with no STRONG edge). */
  unlinkedCards: 5,
  /** C7: deck mean quality, at least (research 45, kept). */
  meanQuality: 45,
  /** C7: single-card quality floor (research 25), waived with `waiverStrong` strong edges in the deck. */
  cardQuality: 25,
  waiverStrong: 3,
  /** C7: cards under the single-card floor without the waiver, at most (research 0). */
  weakCards: 1,
  /** C8: cards both off-plan and unlinked, at most (research: at most 3 off-plan cards). */
  looseCards: 4,
  /** C5: strong partners of a build-around card in the deck, at least (research 3, kept). */
  buildAroundPartners: 3,
};

/** Games of the energy model behind C2-C3 (the rating's count, so both share the model's cache). */
export const FLOOR_ENERGY_GAMES = ENERGY.ratingGames;

const pct = (x: number): string => `${Math.round(x * 100)}%`;
const r1 = (x: number): string => (Math.round(x * 10) / 10).toFixed(1);
const asDeck = (deck: Deck, ids: readonly string[]): Deck => ({ ...deck, cards: ids.map((defId) => ({ defId, locked: false })) });

/** Pairs with score >= FLOOR.linkedEdge, and the cards in none of them. */
export function linkedStats(db: CardDb, ids: readonly string[]): { pairs: number; unlinked: string[] } {
  const set = new Set(ids);
  const linked = new Set<string>();
  let pairs = 0;
  for (const id of ids) {
    for (const e of db.edges(id)) {
      if (e.a !== id || e.a === e.b || !set.has(e.b) || e.score < FLOOR.linkedEdge!) continue;
      pairs++;
      linked.add(e.a);
      linked.add(e.b);
    }
  }
  return { pairs, unlinked: ids.filter((id) => !linked.has(id)) };
}

/** Strong partners of `card` among `ids`. */
export function strongPartners(db: CardDb, card: string, ids: readonly string[]): string[] {
  const set = new Set(ids);
  const out: string[] = [];
  for (const e of db.edges(card)) {
    const other = e.a === card ? e.b : e.a;
    if (e.strong && other !== card && set.has(other)) out.push(other);
  }
  return out.sort();
}

/**
 * The synergy sub-score value of rate.ts (before weighting), for the ablation check: sum of positive
 * pair scores, strong pairs and connected cards against targets scaled by the deck's pair count, minus
 * anti-synergy, clamped to [0, 1]. Kept equal to rate.ts `synergy()` (tested through rateDeck).
 */
export function synergyValue(db: CardDb, ids: readonly string[]): number {
  const stats = pairStats(db, ids);
  const pairScale = ids.length > 1 ? (ids.length * (ids.length - 1)) / 2 / 66 : 0;
  const sumTarget = Math.max(0.5, SYNERGY.sumTarget * pairScale);
  const strongTarget = Math.max(1, SYNERGY.strongTarget * pairScale);
  const orphans = ids.filter((id) => (stats.best.get(id) ?? 0) < SYNERGY.weakEdge).length;
  const connected = ids.length ? 1 - orphans / ids.length : 0;
  const v = SYNERGY.wSum * Math.min(1, stats.synSum / sumTarget) + SYNERGY.wStrong * Math.min(1, stats.strong.length / strongTarget)
    + SYNERGY.wConnected * connected - SYNERGY.antiPenalty * stats.antiSum;
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
}

function check(key: string, label: string, value: number, threshold: number, atLeast: boolean, detail: string, provenance: FloorCheck['provenance']): FloorCheck {
  const v = Number.isFinite(value) ? value : 0;
  return { key, label, value: v, threshold, passed: atLeast ? v >= threshold : v <= threshold, detail, provenance };
}

/**
 * The power floor of a deck. `buildAround` adds C5 for each named card that is in the deck: at least
 * three strong partners, and a primary plan at the C4 threshold without it. Never throws; a partial or
 * empty deck gets every check with a value (and fails C1).
 */
export function checkFloor(deck: Deck, ctx: EngineContext, buildAround: string[] = []): FloorReport {
  const db = ctx.db;
  const ids = deckIds(deck, db);
  const checks: FloorCheck[] = [];

  // C1 legality (rules).
  const violations = validateDeck(deck, db, ctx.owned);
  const errors = violations.filter((v) => v.severity === 'error');
  const legal = isLegal(violations) && ids.length === 12;
  checks.push(check('legal', 'Legal', legal ? 1 : 0, 1, true, legal ? '12 different released cards, legal in the mode.' : errors.map((v) => v.message).join(' ') || `${ids.length} known cards; a deck needs 12.`, 'derived'));

  // C2-C3 energy (derived model).
  const m = energyModel(asDeck(deck, ids), db, undefined, FLOOR_ENERGY_GAMES);
  checks.push(check('energy', 'Energy spent', m.expectedSpent, FLOOR.energySpent!, true, `Spends ${r1(m.expectedSpent)} of 21 energy in the model (average cost ${m.avgCost.toFixed(2)}); at least ${FLOOR.energySpent} needed.`, 'derived'));
  const np3 = m.pNoPlay[3] ?? 1;
  checks.push(check('noPlayT3', 'No play on turn 3', np3, FLOOR.noPlayT3!, false, `No play on turn 3 in ${pct(np3)} of games (at most ${pct(FLOOR.noPlayT3!)}); ${m.curve.slice(0, 4).reduce((s, x) => s + x, 0)} cards cost 3 or less.`, 'derived'));

  // C4 plan (heuristic families, exact assembly odds), with the network alternative.
  const plans = detectPlans(asDeck(deck, ids), ctx);
  const linked = linkedStats(db, ids);
  const p = plans.primary;
  const asm = p?.assembly ?? 0;
  const alt = linked.pairs >= FLOOR.linkedPairsAlt!;
  const planCheck = check('plan', 'Plan assembles', asm, FLOOR.planAssembly!, true,
    p ? `${p.name}: ${names(db, p.enablers)} with ${names(db, p.payoffs)}, ${pct(asm)} by turn ${p.keyTurn} (at least ${pct(FLOOR.planAssembly!)}).`
      : `No plan family reaches ${pct(FLOOR.planAssembly!)} assembly${plans.all[0] ? `; closest ${plans.all[0].name} at ${pct(plans.all[0].assembly)}` : ''}.`, 'heuristic');
  if (!planCheck.passed && alt) {
    planCheck.passed = true;
    planCheck.detail += ` Passed by the network instead: ${linked.pairs} linked pairs (at least ${FLOOR.linkedPairsAlt}) stand in for a family plans.json lacks.`;
  }
  checks.push(planCheck);

  // C6 synergy density (heuristic network).
  const stats = pairStats(db, ids);
  const strongCheck = check('strongPairs', 'Strong pairs', stats.strong.length, FLOOR.strongPairs!, true,
    `${stats.strong.length} strong pairs of ${ids.length > 1 ? (ids.length * (ids.length - 1)) / 2 : 0}${stats.strong.length ? `: ${stats.strong.slice(0, 3).map((e) => `${nameOf(db, e.a)} + ${nameOf(db, e.b)}`).join('; ')}${stats.strong.length > 3 ? '; ...' : ''}` : ''} (at least ${FLOOR.strongPairs}).`, 'heuristic');
  if (!strongCheck.passed && alt) {
    strongCheck.passed = true;
    strongCheck.detail += ` Passed by ${linked.pairs} linked pairs (at least ${FLOOR.linkedPairsAlt}).`;
  }
  checks.push(strongCheck);
  checks.push(check('unlinked', 'Cards with no partner', linked.unlinked.length, FLOOR.unlinkedCards!, false,
    linked.unlinked.length ? `${names(db, linked.unlinked)} ${linked.unlinked.length === 1 ? 'has' : 'have'} no pair of ${FLOOR.linkedEdge} or more in the deck (at most ${FLOOR.unlinkedCards}).` : 'Every card has a partner in the deck.', 'heuristic'));

  // C7 card quality (heuristic).
  const qs = ids.map((id) => ({ id, q: db.features(id)?.quality ?? 50 }));
  const mean = qs.length ? qs.reduce((s, x) => s + x.q, 0) / qs.length : 0;
  checks.push(check('meanQuality', 'Mean card quality', mean, FLOOR.meanQuality!, true, `Mean quality ${Math.round(mean)} of 100 (at least ${FLOOR.meanQuality}).`, 'heuristic'));
  const weak = qs.filter((x) => x.q < FLOOR.cardQuality! && (stats.degree.get(x.id) ?? 0) < FLOOR.waiverStrong!);
  checks.push(check('weakCards', 'Weak cards', weak.length, FLOOR.weakCards!, false,
    weak.length ? `${weak.map((x) => `${nameOf(db, x.id)} (${Math.round(x.q)})`).join(', ')} under quality ${FLOOR.cardQuality} with fewer than ${FLOOR.waiverStrong} strong edges (at most ${FLOOR.weakCards}).` : `No card under quality ${FLOOR.cardQuality} without ${FLOOR.waiverStrong} strong edges.`, 'heuristic'));

  // C8 loose cards (heuristic).
  const off = new Set(plans.offPlan);
  const loose = linked.unlinked.filter((id) => off.has(id));
  checks.push(check('looseCards', 'Loose cards', loose.length, FLOOR.looseCards!, false,
    loose.length ? `${names(db, loose)} ${loose.length === 1 ? 'is' : 'are'} in no plan and linked to no card (at most ${FLOOR.looseCards}).` : 'Every card is in a plan or linked to another card.', 'heuristic'));

  // C5 build-around (heuristic network and plans).
  for (const card of buildAround) {
    if (!ids.includes(card)) {
      checks.push(check(`partners:${card}`, `${nameOf(db, card)} partners`, 0, FLOOR.buildAroundPartners!, true, `${nameOf(db, card)} is not in the deck.`, 'heuristic'));
      continue;
    }
    const partners = strongPartners(db, card, ids);
    checks.push(check(`partners:${card}`, `${nameOf(db, card)} partners`, partners.length, FLOOR.buildAroundPartners!, true,
      `${nameOf(db, card)} has ${partners.length} strong partner${partners.length === 1 ? '' : 's'}${partners.length ? ` (${names(db, partners)})` : ''}; at least ${FLOOR.buildAroundPartners} needed.`, 'heuristic'));
    const rest = ids.filter((x) => x !== card);
    const without = detectPlans(asDeck(deck, rest), ctx).primary;
    const wa = without?.assembly ?? 0;
    checks.push(check(`without:${card}`, `Plan without ${nameOf(db, card)}`, wa, FLOOR.planAssembly!, true,
      without ? `Without ${nameOf(db, card)}: ${without.name} still assembles in ${pct(wa)} by turn ${without.keyTurn}.` : `Without ${nameOf(db, card)} no plan reaches ${pct(FLOOR.planAssembly!)} assembly.`, 'heuristic'));
    // Ablation (theory §4.8): without the card the plan or the synergy must get weaker, else it is decoration.
    const sBefore = p?.strength ?? 0;
    const sAfter = without?.strength ?? 0;
    const yBefore = synergyValue(db, ids);
    const yAfter = synergyValue(db, rest);
    const dPlan = sBefore - sAfter;
    const dSyn = yBefore - yAfter;
    const matters = dPlan > 1e-9 || dSyn > 1e-9;
    checks.push(check(`ablation:${card}`, `${nameOf(db, card)} is load-bearing`, matters ? 1 : 0, 1, true,
      `Removing ${nameOf(db, card)} changes plan strength ${pct(sBefore)} -> ${pct(sAfter)} and the synergy sub-score ${pct(yBefore)} -> ${pct(yAfter)}${matters ? '' : ': neither drops, so the card is decoration'}.`, 'heuristic'));
  }

  return { passed: checks.every((c) => c.passed), checks };
}
