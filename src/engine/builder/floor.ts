/**
 * Power floor (spec §14; docs/research/deck-theory-and-creativity.md §4.5 C1-C8, §4.8): the hard
 * filter on every deck the builder returns. Each check reports its value, threshold and status.
 *
 * C1 legality and C5's partner count are rules; C2-C3 come from the derived energy model; C4, C6-C8
 * read the HEURISTIC plan catalogue and interaction network plus, since the calibration pass, MEASURED
 * pair evidence (co-play lift in the synced corpus) and the archetype-core fallback. Every threshold
 * below is HEURISTIC and tuned against the known-good / known-bad test of theory §4.8
 * (tests/engine/builder.test.ts): the 200 most-played fixture lists against 50 seeded random piles.
 *
 * Calibration pass (2026-11-13): C6 was a count of strong edges (>= 0.5), and the network finds a median
 * of 1 per meta list, so 71 of 200 real lists failed it. It is now graded COHESION (rating/deck.ts
 * `cohesionOf`): every pair counts its graded mechanical weight (0.2 -> 0, 0.5 -> 1, x0.8) or its measured
 * co-play weight, whichever is larger. C5 counts real PARTNERS (network/edges.ts `isPartner`: strong, or
 * 0.4+ with a text-derived reason; band audit 85% strict held out). C4 also passes on the core of a known
 * archetype (plans/detect.ts `archetypeCore`, measured). Before/after numbers: docs/HANDOVER.md
 * "After the calibration pass".
 */
import { energyModel } from '../maths/energy';
import { deckIds } from '../novelty/novelty';
import { isPartner } from '../network/edges';
import { archetypeCore, detectPlans } from '../plans/detect';
import { COHESION, ENERGY } from '../rating/constants';
import { cohesionBar, cohesionOf, cohesionPairsText, pairStats, names, nameOf, synergyValueOf } from '../rating/deck';
import { findFormat, formatName, isCheckedFormat } from '../rules/formats';
import { isLegal, validateDeck } from '../rules/validate';
import type { CardDb, Deck, EngineContext, FloorCheck, FloorReport } from '../types';

/** Floor thresholds (HEURISTIC; research default in each comment). */
export const FLOOR: Record<string, number> = {
  /** C2: modelled energy spent of 21, at least (research 18.0 from 15 lists; calibration pass: 17.5, the 5th percentile of the
   * 200 most-played fixture lists is 17.8: the model ignores generated cards and cost cuts, so real lists sit below 18). */
  energySpent: 17.5,
  /** C3: P(no play on turn 3), at most (research 10% from 15 lists; calibration pass: 25%, the 95th percentile of the 200 lists is 24%). */
  noPlayT3: 0.25,
  /** C4: primary plan assembly by its key turn, at least (research 80%; here the plan threshold of spec §10). */
  planAssembly: 0.6,
  /** C4 alternative: cohesion at least this high stands in for a plan family the catalogue lacks (random piles reach 6.0 at most). */
  cohesionPlanAlt: 12,
  /** A pair at or above this score links two cards (rating SYNERGY.weakEdge). */
  linkedEdge: 0.2,
  /** C6: graded cohesion of 66 pairs, at least (research: 10 strong pairs; calibration pass); never below what random piles reach (`cohesionBar`). */
  cohesion: COHESION.bar,
  /** C6: cards with no pair of `linkedEdge` or more and no measured co-play pair, at most (research: at most 2 cards with no STRONG edge). */
  unlinkedCards: 5,
  /** C7: deck mean quality, at least (research 45, kept). */
  meanQuality: 45,
  /** C7: single-card quality floor (research 25), waived with `waiverStrong` partners in the deck (real partners or measured pairs of weight 0.5+). */
  cardQuality: 25,
  waiverStrong: 3,
  /** C7: cards under the single-card floor without the waiver, at most (research 0). */
  weakCards: 1,
  /** C8: cards both off-plan and unlinked, at most (research: at most 3 off-plan cards). */
  looseCards: 4,
  /** C5: real partners (strong, or 0.4+ text-backed) of a build-around card in the deck, at least (research 3 strong; calibration pass). */
  buildAroundPartners: 3,
  /** Ablation (theory §4.8) for a card outside the plans: synergy sub-score drop, at least (engine review, 2026-11-13). */
  ablationSynergy: 0.05,
  /** ... together with this many real partners that are pieces of the primary plan. */
  ablationPiecePartners: 2,
};

/** C6 bar for this database: FLOOR.cohesion, or the most cohesion seeded random piles reach when that is higher (rating/deck.ts cohesionNull). */
export { cohesionBar };

/** Games of the energy model behind C2-C3 (the rating's count, so both share the model's cache). */
export const FLOOR_ENERGY_GAMES = ENERGY.ratingGames;

const pct = (x: number): string => `${Math.round(x * 100)}%`;
const r1 = (x: number): string => (Math.round(x * 10) / 10).toFixed(1);
const asDeck = (deck: Deck, ids: readonly string[]): Deck => ({ ...deck, cards: ids.map((defId) => ({ defId, locked: false })) });

/** Pairs with score >= FLOOR.linkedEdge, and the cards in none of them (mechanical edges only; the floor's C6 uses `cohesionOf`). */
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

/** Real partners of `card` among `ids` (network/edges.ts `isPartner`: strong, or 0.4+ with a text-derived reason). Mechanical only. */
export function realPartners(db: CardDb, card: string, ids: readonly string[]): string[] {
  const set = new Set(ids);
  const out: string[] = [];
  for (const e of db.edges(card)) {
    const other = e.a === card ? e.b : e.a;
    if (other !== card && set.has(other) && isPartner(e)) out.push(other);
  }
  return out.sort();
}

/**
 * The synergy sub-score value of rate.ts (before weighting) WITHOUT the mechanical cap, for the ablation check: graded cohesion
 * (mechanical and measured pairs) against a target scaled by the deck's pair count, the share of linked
 * cards, minus anti-synergy, clamped to [0, 1] (rating/deck.ts `synergyValueOf`).
 */
export function synergyValue(db: CardDb, ids: readonly string[]): number {
  return synergyValueOf(cohesionOf(db, ids), ids.length, pairStats(db, ids).antiSum, false);
}

/**
 * Conditions a card states about your own past actions, and the axis whose enablers meet them
 * (text/vocab.ts condition names). A hardcode because the condition names are parser vocabulary,
 * not card data; extend it when the vocabulary grows. HEURISTIC: an enabler being in the deck does
 * not guarantee the condition is met in a game.
 */
const CONDITION_NEEDS: Record<string, { axes: string[]; text: string }> = {
  have_discarded: { axes: ['discard'], text: 'discards one of your cards' },
  have_destroyed: { axes: ['destroy'], text: 'destroys one of your cards' },
  have_discarded_and_destroyed: { axes: ['discard', 'destroy'], text: 'discards and destroys your cards' },
};

export interface StatedNeed { anyOf: string[]; text: string; clause: string }

/**
 * What a card states it needs from your other cards (HEURISTIC): its conditions on your past discards or destroys, and
 * (calibration pass) its revive effects: "Revive one of your destroyed cards" (Phoenix Force) does nothing in a deck that
 * never destroys its own cards, "discarded or destroyed" (Firelord) needs either. Each need lists the enabler axes of
 * which any one other card meets it. Objective counts of your destroyed cards (Archangel) need a destroyer too.
 */
export function statedNeeds(db: CardDb, card: string): StatedNeed[] {
  const f = db.features(card);
  if (!f) return [];
  const out: StatedNeed[] = [];
  for (const cl of f.clauses) {
    for (const cond of cl.conditions) {
      if (cond === 'obj:destroyed') { out.push({ anyOf: ['destroy'], text: 'destroys one of your cards', clause: cl.text }); continue; }
      const need = CONDITION_NEEDS[cond];
      if (!need) continue;
      for (const axis of need.axes) out.push({ anyOf: [axis], text: need.text, clause: cl.text });
    }
    for (const e of cl.effects) {
      if (e.kind !== 'resurrect' || e.target !== 'own') continue;
      const destroyed = /destroyed/.test(cl.text);
      const discarded = /discarded/.test(cl.text);
      if (destroyed && discarded) out.push({ anyOf: ['destroy', 'discard'], text: 'destroys or discards one of your cards', clause: cl.text });
      else if (destroyed) out.push({ anyOf: ['destroy'], text: 'destroys one of your cards', clause: cl.text });
      else if (discarded) out.push({ anyOf: ['discard'], text: 'discards one of your cards', clause: cl.text });
    }
  }
  return out;
}

/**
 * Stated needs of `card` that no other card of `ids` can meet (engine review: Fantomex's "If you've had cards discarded and
 * destroyed" in a deck with no discard; calibration pass: Phoenix Force in a deck that destroys nothing). One line per unmet need.
 */
export function unmetConditions(db: CardDb, card: string, ids: readonly string[]): string[] {
  const out: string[] = [];
  for (const need of statedNeeds(db, card)) {
    const met = ids.some((x) => x !== card && need.anyOf.some((axis) => (db.features(x)?.axes[axis]?.e ?? 0) > 0));
    if (!met) out.push(`${nameOf(db, card)} needs a card that ${need.text} ("${need.clause}"), and no other card in the deck does.`);
  }
  return [...new Set(out)];
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
  const fmtId = typeof deck?.format === 'string' ? deck.format : 'ranked';
  const fmt = findFormat(db, fmtId);
  const legalText = isCheckedFormat(fmt) ? `12 different released cards, legal in ${fmt!.name}.`
    : fmt && !fmt.constructed ? `12 different released cards, legal under Ranked rules; ${fmt.name} decks are drafted in-game.`
      : `12 different released cards, legal under Ranked rules; ${formatName(db, fmtId)} restrictions are not verified.`;
  checks.push(check('legal', 'Legal', legal ? 1 : 0, 1, true, legal ? legalText : errors.map((v) => v.message).join(' ') || `${ids.length} known cards; a deck needs 12.`, 'derived'));

  // C2-C3 energy (derived model).
  const m = energyModel(asDeck(deck, ids), db, undefined, FLOOR_ENERGY_GAMES);
  checks.push(check('energy', 'Energy spent', m.expectedSpent, FLOOR.energySpent!, true, `Spends ${r1(m.expectedSpent)} of 21 energy in the model (average cost ${m.avgCost.toFixed(2)}); at least ${FLOOR.energySpent} needed.`, 'derived'));
  const np3 = m.pNoPlay[3] ?? 1;
  checks.push(check('noPlayT3', 'No play on turn 3', np3, FLOOR.noPlayT3!, false, `No play on turn 3 in ${pct(np3)} of games (at most ${pct(FLOOR.noPlayT3!)}); ${m.curve.slice(0, 4).reduce((s, x) => s + x, 0)} cards cost 3 or less.`, 'derived'));

  // C4 plan (heuristic families, exact assembly odds), with two alternatives: the core of a known archetype (measured)
  // and high cohesion (a package plans.json has no family for).
  const plans = detectPlans(asDeck(deck, ids), ctx);
  const coh = cohesionOf(db, ids);
  const core = archetypeCore(db, ids);
  const p = plans.primary;
  const asm = p?.assembly ?? 0;
  const planCheck = check('plan', 'Plan assembles', asm, FLOOR.planAssembly!, true,
    p ? `${p.name}: ${names(db, p.enablers)} with ${names(db, p.payoffs)}, ${pct(asm)} by turn ${p.keyTurn} (at least ${pct(FLOOR.planAssembly!)}).`
      : `No plan family reaches ${pct(FLOOR.planAssembly!)} assembly${plans.all[0] ? `; closest ${plans.all[0].name} at ${pct(plans.all[0].assembly)}` : ''}.`, 'heuristic');
  if (!planCheck.passed && core) {
    planCheck.passed = true;
    planCheck.provenance = 'measured';
    planCheck.detail += ` Passed as a known archetype instead: the deck holds ${core.shared.length} of the ${core.core.length} most-played cards of ${core.name} (${names(db, core.shared)}; ${core.games} games in the synced snapshot, measured).`;
  } else if (!planCheck.passed && coh.total >= FLOOR.cohesionPlanAlt!) {
    planCheck.passed = true;
    planCheck.detail += ` Passed by cohesion instead: ${r1(coh.total)} (at least ${FLOOR.cohesionPlanAlt}) stands in for a family plans.json lacks.`;
  }
  checks.push(planCheck);

  // C6 cohesion (graded heuristic network plus measured co-play).
  const n = ids.length > 1 ? (ids.length * (ids.length - 1)) / 2 : 0;
  const bar = cohesionBar(db);
  checks.push(check('cohesion', 'Cohesion', coh.total, bar, true,
    `Cohesion ${r1(coh.total)} over ${n} pairs (at least ${r1(bar)}${bar > FLOOR.cohesion! ? ', the most that random piles of this pool reach' : ''}): ${r1(coh.mech)} from the interaction network (pairs of 0.2 or more, graded, heuristic)${coh.measured > 0.05 ? ` and ${r1(coh.measured)} more from co-play in the meta corpus (measured)` : ''}${coh.pairs.length ? `. Heaviest: ${cohesionPairsText(db, coh)}` : ''}.`,
    coh.measured > coh.mech ? 'measured' : 'heuristic'));
  checks.push(check('unlinked', 'Cards with no partner', coh.unlinked.length, FLOOR.unlinkedCards!, false,
    coh.unlinked.length ? `${names(db, coh.unlinked)} ${coh.unlinked.length === 1 ? 'has' : 'have'} no pair of ${FLOOR.linkedEdge} or more and no measured co-play pair in the deck (at most ${FLOOR.unlinkedCards}).` : 'Every card has a partner in the deck.', 'heuristic'));

  // C7 card quality (heuristic); the waiver counts real partners.
  const qs = ids.map((id) => ({ id, q: db.features(id)?.quality ?? 50 }));
  const mean = qs.length ? qs.reduce((s, x) => s + x.q, 0) / qs.length : 0;
  checks.push(check('meanQuality', 'Mean card quality', mean, FLOOR.meanQuality!, true, `Mean quality ${Math.round(mean)} of 100 (at least ${FLOOR.meanQuality}).`, 'heuristic'));
  const support = new Map(coh.partners);
  for (const pr of coh.pairs) if (pr.measured >= 0.5 && !isPartner(pr.edge)) for (const x of [pr.a, pr.b]) support.set(x, (support.get(x) ?? 0) + 1);
  const weak = qs.filter((x) => x.q < FLOOR.cardQuality! && (support.get(x.id) ?? 0) < FLOOR.waiverStrong!);
  checks.push(check('weakCards', 'Weak cards', weak.length, FLOOR.weakCards!, false,
    weak.length ? `${weak.map((x) => `${nameOf(db, x.id)} (${Math.round(x.q)})`).join(', ')} under quality ${FLOOR.cardQuality} with fewer than ${FLOOR.waiverStrong} partners (at most ${FLOOR.weakCards}).` : `No card under quality ${FLOOR.cardQuality} without ${FLOOR.waiverStrong} partners.`, 'heuristic'));

  // C8 loose cards (heuristic): off-plan and linked to nothing. Cards of a matched archetype core are on plan.
  const off = new Set(plans.offPlan.filter((id) => !core?.shared.includes(id)));
  const loose = coh.unlinked.filter((id) => off.has(id));
  checks.push(check('looseCards', 'Loose cards', loose.length, FLOOR.looseCards!, false,
    loose.length ? `${names(db, loose)} ${loose.length === 1 ? 'is' : 'are'} in no plan and linked to no card (at most ${FLOOR.looseCards}).` : 'Every card is in a plan or linked to another card.', 'heuristic'));

  // Stated needs (calibration pass, heuristic): a card that revives or counts your destroyed or discarded cards needs a card that
  // destroys or discards them.
  const unmet = ids.flatMap((id) => unmetConditions(db, id, ids));
  checks.push(check('needs', 'Unmet needs', unmet.length, 0, false, unmet.length ? unmet.join(' ') : 'Every card that needs a destroyed or discarded card has a card in the deck that provides it.', 'heuristic'));

  // C5 build-around (heuristic network and plans).
  for (const card of buildAround) {
    if (!ids.includes(card)) {
      checks.push(check(`partners:${card}`, `${nameOf(db, card)} partners`, 0, FLOOR.buildAroundPartners!, true, `${nameOf(db, card)} is not in the deck.`, 'heuristic'));
      continue;
    }
    const partners = realPartners(db, card, ids);
    checks.push(check(`partners:${card}`, `${nameOf(db, card)} partners`, partners.length, FLOOR.buildAroundPartners!, true,
      `${nameOf(db, card)} has ${partners.length} partner${partners.length === 1 ? '' : 's'} in the interaction network${partners.length ? ` (${names(db, partners)})` : ''}; at least ${FLOOR.buildAroundPartners} needed (a partner is a strong edge, or 0.4+ with a text-derived reason; measured co-play does not count here).`, 'heuristic'));
    const rest = ids.filter((x) => x !== card);
    const withoutReport = detectPlans(asDeck(deck, rest), ctx);
    const without = withoutReport.primary;
    const wa = without?.assembly ?? 0;
    checks.push(check(`without:${card}`, `Plan without ${nameOf(db, card)}`, wa, FLOOR.planAssembly!, true,
      without ? `Without ${nameOf(db, card)}: ${without.name} still assembles in ${pct(wa)} by turn ${without.keyTurn}.` : `Without ${nameOf(db, card)} no plan reaches ${pct(FLOOR.planAssembly!)} assembly.`, 'heuristic'));
    // Ablation (theory §4.8): without the card its plan or the deck's synergy must get materially weaker, else it is decoration.
    // Changed after the engine review (2026-11-13): a synergy drop of any size let decks pass whose primary plan did not use the
    // card at all (Sunspot in a Move deck, 98% assembly with or without it). The card must now be an enabler or payoff of the
    // primary or secondary plan and that plan must weaken without it, or the synergy sub-score must drop by
    // `FLOOR.ablationSynergy` with at least `FLOOR.ablationPiecePartners` real partners that are pieces of the primary plan
    // (partners in the secondary plan only do not count: Sunspot's energy partners sat beside a Move deck) (HEURISTIC).
    const planOf = [plans.primary, plans.secondary].find((x) => x && (x.enablers.includes(card) || x.payoffs.includes(card))) ?? null;
    const pieces = new Set(plans.primary ? [...plans.primary.enablers, ...plans.primary.payoffs] : []);
    const piecePartners = partners.filter((x) => pieces.has(x));
    const sBefore = planOf?.strength ?? 0;
    const sAfter = planOf ? (withoutReport.all.find((x) => x.planId === planOf.planId)?.strength ?? 0) : 0;
    const yBefore = synergyValue(db, ids);
    const yAfter = synergyValue(db, rest);
    const dPlan = sBefore - sAfter;
    const dSyn = yBefore - yAfter;
    const inPlan = planOf !== null && dPlan > 1e-9;
    const material = dSyn >= FLOOR.ablationSynergy! && piecePartners.length >= FLOOR.ablationPiecePartners!;
    const matters = inPlan || material;
    const why = inPlan
      ? `${nameOf(db, card)} is ${planOf!.enablers.includes(card) ? 'an enabler' : 'a payoff'} of ${planOf!.name}: its strength goes ${pct(sBefore)} -> ${pct(sAfter)} without it`
      : `${nameOf(db, card)} is ${planOf ? `in ${planOf.name} but the plan does not weaken without it` : `in neither the primary nor the secondary plan${plans.primary ? ` (${plans.primary.name})` : ''}`}; the synergy sub-score goes ${pct(yBefore)} -> ${pct(yAfter)} with ${piecePartners.length} partner${piecePartners.length === 1 ? '' : 's'} among the primary plan's pieces${piecePartners.length ? ` (${names(db, piecePartners)})` : ''}`;
    checks.push(check(`ablation:${card}`, `${nameOf(db, card)} is load-bearing`, matters ? 1 : 0, 1, true,
      `${why}${matters ? '.' : `: neither the plan nor a drop of ${pct(FLOOR.ablationSynergy!)} with ${FLOOR.ablationPiecePartners} primary-plan partners, so the card is decoration.`}`, 'heuristic'));
  }

  return { passed: checks.every((c) => c.passed), checks };
}
