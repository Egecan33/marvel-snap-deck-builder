/**
 * Deck rating (spec §12): seven sub-scores, each a value in [0, 1] times its weight, with up to three
 * fixes naming cards and numbers. A construction check, not a win-rate prediction. Weights, targets
 * and the shape of every sub-score are HEURISTIC (rating/constants.ts); energy and assembly odds are
 * derived from models, tech play rates are measured.
 *
 * Incomplete decks scale their targets by size (f = cards / 12) and report `complete: false`. An
 * illegal deck is capped at 40. Never throws and never returns NaN: unknown cards are ignored.
 */
import { energyModel } from '../maths/energy';
import { deckIds } from '../novelty/novelty';
import { archetypeCore, detectPlans, type ArchetypeCore } from '../plans/detect';
import { isLegal, validateDeck } from '../rules/validate';
import type { CardDb, Deck, DeckRating, EngineContext, Fix, PlanMatch, PlanReport, Provenance, SubScore, Violation } from '../types';
import { COHERENCE, COHESION, CONSISTENCY, ENERGY, ILLEGAL_CAP, MAX_FIXES, PLAN, QUALITY, RATING_WEIGHTS, RESILIENCE, SYNERGY } from './constants';
import { cohesionBar, cohesionOf, cohesionPairsText, tiedCards, edgeLabel, filterFor, nameOf, names, nearPlans, pairStats, patternWords, synergyValueOf, unreachableRestrictions, unsupportedPayoffs, type Cohesion, type PairStats } from './deck';
import { AXIS_BY_ID } from '../features/axes';

const SIZE = 12;
const clamp01 = (x: number): number => (Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0);
const pct = (x: number): string => `${Math.round(x * 100)}%`;
const r1 = (x: number): string => (Math.round(x * 10) / 10).toFixed(1);

interface Ctx { db: CardDb; ids: string[]; f: number; stats: PairStats; plans: PlanReport; coh: Cohesion; core: ArchetypeCore | null }

/**
 * Share 0..1 of package credit for a deck with no family and no known core (calibration pass): how far its cohesion
 * rises from the bar random piles reach toward COHESION.fullCredit (HEURISTIC).
 */
function packageShare(c: Ctx): number {
  if (c.plans.primary || c.core) return 0;
  const pairScale = c.ids.length > 1 ? (c.ids.length * (c.ids.length - 1)) / 2 / 66 : 0;
  const bar = cohesionBar(c.db) * pairScale;
  const full = Math.max(bar + 1e-9, COHESION.fullCredit * pairScale);
  return clamp01((c.coh.total - bar) / (full - bar));
}

function sub(key: keyof typeof RATING_WEIGHTS, label: string, value: number, fixes: Fix[], provenance: Provenance): SubScore {
  return { key, label, weight: RATING_WEIGHTS[key], value: clamp01(value), fixes: fixes.slice(0, MAX_FIXES), provenance };
}

/** Most common enabler axis among the deck's payoffs, for "add more of X" fixes. */
function deckAxis(c: Ctx): string | null {
  const count = new Map<string, number>();
  for (const id of c.ids) for (const [k, v] of Object.entries(c.db.features(id)?.axes ?? {})) if (v.p >= 1 || v.e >= 1) count.set(k, (count.get(k) ?? 0) + 1);
  return [...count].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0] ?? null;
}

function synergy(c: Ctx): SubScore {
  const { db, ids, f, stats, coh } = c;
  const value = synergyValueOf(coh, ids.length, stats.antiSum);
  const pairScale = ids.length > 1 ? (ids.length * (ids.length - 1)) / 2 / 66 : 0;
  const target = Math.max(0.5, COHESION.fullCredit * pairScale);
  const fixes: Fix[] = [];
  for (const e of stats.anti.slice(0, 1)) {
    fixes.push({ text: `${nameOf(db, e.a)} and ${nameOf(db, e.b)} work against each other (${edgeLabel(e, 'anti')}, anti ${r1(e.anti)}): cut one of them.`, filter: null });
  }
  const orphans = coh.unlinked;
  if (orphans.length > 0) {
    const axis = deckAxis(c);
    fixes.push({
      text: `${names(db, orphans.slice(0, 4))}${orphans.length > 4 ? ` and ${orphans.length - 4} more` : ''} ${orphans.length === 1 ? 'has' : 'have'} no interaction of ${SYNERGY.weakEdge} or more and no measured co-play with the rest of the deck${axis ? `: replace with cards on ${AXIS_BY_ID.get(axis)?.label ?? axis}` : ''}.`,
      filter: axis ? { axis } : null,
    });
  }
  if (coh.total < target) {
    const axis = deckAxis(c);
    fixes.push({ text: `Cohesion ${r1(coh.total)} (full credit at ${r1(target)}${f < 1 ? ', scaled to the cards so far' : ''}): ${r1(coh.mech)} from the interaction network (heuristic)${coh.measured > 0.05 ? `, ${r1(coh.measured)} from co-play in the meta corpus (measured)` : ''}.${axis ? ` Most of the deck is on ${AXIS_BY_ID.get(axis)?.label ?? axis}; more cards there add pairs.` : ''}`, filter: axis ? { axis } : null });
  }
  // Measured when proven pairs carry most of the cohesion, heuristic otherwise.
  return sub('synergy', 'Synergy', value, fixes, coh.measured > coh.mech ? 'measured' : 'heuristic');
}

/**
 * Share of the primary plan's enabler x payoff pairs that the network also links (score at or above
 * the weak-edge mark). HEURISTIC check that a detected plan is a real package: broad families can
 * match cards that do not act on each other.
 */
export function planLinkage(db: CardDb, p: PlanMatch): number {
  let pairs = 0;
  let linked = 0;
  for (const e of p.enablers) {
    for (const q of p.payoffs) {
      if (e === q) continue;
      pairs++;
      if ((db.edge(e, q)?.score ?? 0) >= SYNERGY.weakEdge) linked++;
    }
  }
  return pairs ? linked / pairs : 0;
}

const effective = (db: CardDb, p: PlanMatch): number => p.strength * (1 - PLAN.linkageWeight + PLAN.linkageWeight * planLinkage(db, p));

function plan(c: Ctx): SubScore {
  const { db, ids, plans } = c;
  const p = plans.primary;
  let value: number;
  const fixes: Fix[] = [];
  if (p) {
    const q = p.payoffs.length ? p.payoffs.reduce((s, id) => s + (db.features(id)?.quality ?? 50), 0) / p.payoffs.length : 50;
    const qv = clamp01((q - PLAN.payoffQualityLow) / (PLAN.payoffQualityHigh - PLAN.payoffQualityLow));
    const sv = plans.secondary ? clamp01((effective(db, plans.secondary) - PLAN.zeroStrength) / (PLAN.fullStrength - PLAN.zeroStrength)) : 0;
    value = PLAN.wPrimary * clamp01((effective(db, p) - PLAN.zeroStrength) / (PLAN.fullStrength - PLAN.zeroStrength)) + PLAN.wPayoffQuality * qv + PLAN.wSecondary * sv;
    // Calibration pass: a deck that also holds a known archetype's core gets at least the core credit (measured archetype).
    if (c.core) value = Math.max(value, PLAN.coreCredit * (c.core.shared.length / c.core.core.length));
    if (p.strength < PLAN.fullStrength) fixes.push({ text: `${p.name}: strength ${pct(p.strength)} (${p.enablers.length} enablers ${names(db, p.enablers)}, ${p.payoffs.length} payoffs ${names(db, p.payoffs)}, assembly ${pct(p.assembly)} by turn ${p.keyTurn}).`, filter: null });
    if (!plans.secondary) fixes.push({ text: `No secondary plan: if ${names(db, p.payoffs)} ${p.payoffs.length === 1 ? 'is' : 'are'} answered, the deck has nothing else to fall back on.`, filter: null });
  } else if (c.core) {
    // Calibration pass: the core of a known archetype is a plan plans.json cannot name (measured archetype, heuristic credit).
    const k = c.core.shared.length / c.core.core.length;
    value = PLAN.coreCredit * k;
    fixes.push({ text: `No plan family fits, but the deck holds ${c.core.shared.length} of the ${c.core.core.length} most-played cards of ${c.core.name} (${names(db, c.core.shared)}; ${c.core.games} games, measured): that archetype is its plan.`, filter: null });
  } else if (packageShare(c) > 0) {
    // Calibration pass: no family and no known core, but the cards cohere well above chance: a package plans.json cannot name.
    value = PLAN.packageCredit * packageShare(c);
    fixes.push({ text: `No plan family fits; the deck is held together by its pairs instead (cohesion ${r1(c.coh.total)}: ${cohesionPairsText(db, c.coh, 2)}).`, filter: null });
    const best = plans.all[0];
    if (best) value = Math.max(value, PLAN.noPrimaryCredit * clamp01(best.strength / PLAN.fullStrength));
  } else {
    const best = plans.all[0];
    value = best ? PLAN.noPrimaryCredit * clamp01(best.strength / PLAN.fullStrength) : 0;
    if (best) fixes.push({ text: `No plan reaches 60% assembly; the closest is ${best.name} (${names(db, [...best.enablers, ...best.payoffs])}, ${pct(best.assembly)} by turn ${best.keyTurn}).`, filter: null });
  }
  const near = nearPlans(db, ids)[0];
  if (near) {
    const patterns = near.missing === 'enabler' ? near.plan.enablerTraits : near.plan.payoffTraits;
    const pattern = patterns.find((pt) => filterFor(pt, near.missing === 'enabler' ? 'e' : 'p')) ?? patterns[0] ?? '';
    const have = near.missing === 'enabler' ? near.payoffs : near.enablers;
    fixes.unshift({
      text: `${near.plan.name}: ${names(db, have)} ${have.length === 1 ? 'needs' : 'need'} ${near.need} more ${near.missing}${near.need === 1 ? '' : 's'}: a card with ${patternWords(pattern, near.missing === 'enabler' ? 'e' : 'p')}.`,
      filter: filterFor(pattern, near.missing === 'enabler' ? 'e' : 'p'),
    });
  }
  return sub('plan', 'Plan', value, fixes, 'heuristic');
}

function energy(c: Ctx, deck: Deck): SubScore {
  const { db, ids, f } = c;
  const fixes: Fix[] = [];
  if (ids.length === 0) return sub('energy', 'Energy', 0, [{ text: 'No cards yet.', filter: null }], 'derived');
  const known: Deck = { ...deck, cards: ids.map((defId) => ({ defId, locked: false })) };
  const m = energyModel(known, db, undefined, ENERGY.ratingGames);
  const floor = ENERGY.floor * f;
  const median = ENERGY.median * f;
  const spentV = clamp01((m.expectedSpent - floor) / Math.max(0.1, median - floor));
  const noPlay = ((m.pNoPlay[2] ?? 0) + (m.pNoPlay[3] ?? 0) + (m.pNoPlay[4] ?? 0)) / 3;
  const value = ENERGY.wSpent * spentV + ENERGY.wNoPlay * (1 - clamp01(noPlay / ENERGY.noPlayCeiling));
  if (m.expectedSpent < median) {
    const heavy = ids.filter((id) => (db.get(id)?.cost ?? 0) >= 5);
    const cheap = ids.filter((id) => (db.get(id)?.cost ?? 0) <= 1);
    const tooCheap = m.avgCost < 2.33;
    fixes.push({
      text: `Spends ${r1(m.expectedSpent)} of 21 energy in the model (floor ${r1(floor)}, meta median ${r1(median)}); average cost ${m.avgCost.toFixed(2)}. ${tooCheap ? `Too cheap: ${names(db, cheap)} cannot fill turns 5 and 6; add a 5- or 6-Cost card.` : `Turns go unspent around ${names(db, heavy.slice(0, 3)) || 'the top of the curve'}; add 2- and 3-Cost cards.`}`,
      filter: tooCheap ? { minCost: 5 } : { minCost: 2, maxCost: 3 },
    });
  }
  for (const t of [2, 3, 4]) {
    const p = m.pNoPlay[t] ?? 0;
    if (p >= 0.1 && fixes.length < MAX_FIXES) fixes.push({ text: `No play on turn ${t} in ${pct(p)} of games: the deck has ${m.curve.slice(0, t + 1).reduce((s, x) => s + x, 0)} cards of cost ${t} or less.`, filter: { maxCost: t } });
  }
  return sub('energy', 'Energy', value, fixes, 'derived');
}

function consistency(c: Ctx): SubScore {
  const { db, ids, plans } = c;
  const p = plans.primary;
  const draws = ids.reduce((s, id) => s + Math.max(0, db.features(id)?.model.extraSeen ?? 0), 0);
  if (!p && c.core) {
    const k = c.core.shared.length / c.core.core.length;
    return sub('consistency', 'Consistency', CONSISTENCY.coreCredit * k + (draws > 0 ? CONSISTENCY.drawBonus : 0), [{ text: `No plan family to time; ${c.core.shared.length} of the ${c.core.core.length} core cards of ${c.core.name} are in the deck (measured), credited without assembly odds (heuristic).`, filter: null }], 'heuristic');
  }
  if (!p && packageShare(c) > 0) return sub('consistency', 'Consistency', CONSISTENCY.packageCredit * packageShare(c) + (draws > 0 ? CONSISTENCY.drawBonus : 0), [{ text: `No plan family to time; the deck's pairs (cohesion ${r1(c.coh.total)}) are credited without assembly odds (heuristic).`, filter: null }], 'heuristic');
  if (!p) return sub('consistency', 'Consistency', 0, [{ text: 'No primary plan, so there is nothing to assemble.', filter: null }], 'derived');
  let value = clamp01((p.assembly - CONSISTENCY.low) / (CONSISTENCY.high - CONSISTENCY.low));
  if (c.core) value = Math.max(value, CONSISTENCY.coreCredit * (c.core.shared.length / c.core.core.length));
  const fixes: Fix[] = [];
  if (p.singleCardDependence) {
    value -= CONSISTENCY.singleCardPenalty;
    const pt = p.payoffs.includes(p.singleCardDependence) ? 'payoff' : 'enabler';
    const plans = db.plans().find((x) => x.id === p.planId);
    const pattern = (pt === 'payoff' ? plans?.payoffTraits : plans?.enablerTraits)?.find((x) => filterFor(x, pt === 'payoff' ? 'p' : 'e')) ?? '';
    fixes.push({ text: `${p.name} rests on ${nameOf(db, p.singleCardDependence)} alone (${pct(p.assembly)} by turn ${p.keyTurn}); a second ${pt} gives redundancy (2 x 2 pieces: 90.9%).`, filter: pattern ? filterFor(pattern, pt === 'payoff' ? 'p' : 'e') : null });
  } else if (p.assembly < CONSISTENCY.high) {
    fixes.push({ text: `${p.name} assembles by turn ${p.keyTurn} in ${pct(p.assembly)} of games with ${p.enablers.length} enablers and ${p.payoffs.length} payoffs; 2 x 2 pieces reach 90.9%.`, filter: null });
  }
  if (draws > 0) value += CONSISTENCY.drawBonus;
  else fixes.push({ text: 'No card draws or pulls extra cards; every piece has to come from the 9 cards seen by turn 6.', filter: { axis: 'draw' } });
  return sub('consistency', 'Consistency', value, fixes, 'derived');
}

function quality(c: Ctx): SubScore {
  const { db, ids, stats } = c;
  if (ids.length === 0) return sub('quality', 'Card quality', 0, [], 'heuristic');
  const qs = ids.map((id) => ({ id, q: db.features(id)?.quality ?? 50 }));
  const mean = qs.reduce((s, x) => s + x.q, 0) / qs.length;
  const weak = qs.filter((x) => x.q < QUALITY.cardFloor && (stats.degree.get(x.id) ?? 0) < QUALITY.waiverStrongEdges).sort((a, b) => a.q - b.q);
  const value = clamp01((mean - QUALITY.meanLow) / (QUALITY.meanHigh - QUALITY.meanLow)) - QUALITY.tailPenalty * weak.length;
  const fixes: Fix[] = weak.slice(0, 2).map((x) => {
    const cost = db.get(x.id)?.cost ?? 0;
    return { text: `${nameOf(db, x.id)} has quality ${Math.round(x.q)} (floor ${QUALITY.cardFloor}) and fewer than ${QUALITY.waiverStrongEdges} strong edges: replace it with a ${cost}-Cost card.`, filter: { minCost: cost, maxCost: cost } };
  });
  if (mean < QUALITY.meanHigh) {
    const low = [...qs].sort((a, b) => a.q - b.q).slice(0, 2);
    fixes.push({ text: `Mean card quality ${Math.round(mean)} (full credit at ${QUALITY.meanHigh}); weakest ${low.map((x) => `${nameOf(db, x.id)} ${Math.round(x.q)}`).join(', ')}.`, filter: null });
  }
  return sub('quality', 'Card quality', value, fixes, 'heuristic');
}

function resilience(c: Ctx): SubScore {
  const { db, plans } = c;
  const p = plans.primary;
  if (!db.meta().info()) return sub('resilience', 'Resilience', p ? RESILIENCE.noMeta : 0, [{ text: 'No meta snapshot: tech play rates are unknown.', filter: null }], 'heuristic');
  if (!p && c.core) return sub('resilience', 'Resilience', RESILIENCE.noMeta * (c.core.shared.length / c.core.core.length), [{ text: `No plan family, so tech exposure is not measured; the deck plays the core of ${c.core.name}.`, filter: null }], 'heuristic');
  if (!p && packageShare(c) > 0) return sub('resilience', 'Resilience', RESILIENCE.noMeta * packageShare(c), [{ text: 'No plan family, so tech exposure is not measured; the deck is a package of interacting cards.', filter: null }], 'heuristic');
  if (!p) return sub('resilience', 'Resilience', 0, [{ text: 'No primary plan, so no plan to protect.', filter: null }], 'measured');
  const hits = p.foldsTo.map((fd) => ({ ...fd, share: fd.fieldShare ?? 0 })).sort((a, b) => b.share - a.share);
  const exposure = 1 - hits.reduce((s, h) => s * (1 - h.share), 1);
  // Resilience of a plan is worth as much as the plan: scaled by the primary's strength.
  const weight = clamp01(effective(db, p) / PLAN.fullStrength);
  let value = 1 - RESILIENCE.exposureWeight * exposure;
  const worst = hits[0];
  const second = plans.secondary;
  const fixes: Fix[] = [];
  if (worst && worst.share > 0) {
    fixes.push({ text: `${p.name} folds to ${worst.role}: ${names(db, worst.cards.slice(0, 3))} ${worst.cards.length > 1 ? 'are' : 'is'} in ${pct(worst.share)} of meta lists.`, filter: null });
    const survives = second && !second.foldsTo.some((x) => x.role === worst.role);
    if (survives) value += RESILIENCE.secondPlanCredit * exposure;
    else fixes.push({ text: second ? `${second.name} folds to ${worst.role} too.` : `No second plan survives ${worst.role}.`, filter: null });
  }
  const coreFloor = c.core ? RESILIENCE.noMeta * (c.core.shared.length / c.core.core.length) : 0;
  return sub('resilience', 'Resilience', Math.max(value * weight, coreFloor), fixes, 'measured');
}

function coherence(c: Ctx, unsupported: { defId: string; axes: string[] }[], unreachable: { defId: string; why: string }[]): SubScore {
  const { db, f, plans } = c;
  const allowed = COHERENCE.offPlanAllowed * f;
  // Calibration pass: cards of a matched archetype core are on plan, and a card tied to the deck by a pair of weight 0.5+
  // (an interaction or measured co-play) is support or tech, not off-plan.
  const tied = tiedCards(c.coh);
  const offPlan = plans.offPlan.filter((id) => !c.core?.shared.includes(id) && !tied.has(id) && !(db.features(id)?.techRoles.length));
  const over = Math.max(0, offPlan.length - allowed);
  const value = 1 - COHERENCE.offPlanPenalty * over - COHERENCE.unsupportedPenalty * unsupported.length - COHERENCE.unreachablePenalty * unreachable.length;
  const fixes: Fix[] = [];
  for (const u of unreachable.slice(0, 1)) fixes.push({ text: `${nameOf(db, u.defId)}: ${u.why}`, filter: null });
  for (const u of unsupported.slice(0, 1)) {
    const axis = u.axes[0]!;
    fixes.push({ text: `${nameOf(db, u.defId)} rewards ${AXIS_BY_ID.get(axis)?.label.toLowerCase() ?? axis}, but nothing in the deck enables it${unsupported.length > 1 ? ` (also ${names(db, unsupported.slice(1, 4).map((x) => x.defId))})` : ''}.`, filter: { axis } });
  }
  if (over > 0) fixes.push({ text: `${offPlan.length} cards are in no plan, tied to no card and not tech (${names(db, offPlan.slice(0, 4))}${offPlan.length > 4 ? ' and more' : ''}); at most ${Math.round(allowed)} can be tech or flex.`, filter: null });
  return sub('coherence', 'Coherence', value, fixes, 'heuristic');
}

/** Heuristic warnings 14-15 of rules §5; they never change the legal verdict. */
function heuristicViolations(db: CardDb, ids: string[], unsupported: { defId: string; axes: string[] }[], unreachable: { defId: string; why: string }[]): Violation[] {
  const out: Violation[] = [];
  if (ids.length >= SIZE) {
    const early = ids.filter((id) => (db.get(id)?.cost ?? 99) <= 2);
    if (early.length === 0) {
      const first = Math.min(...ids.map((id) => db.get(id)?.cost ?? 99));
      out.push({ code: 'CURVE_UNPLAYABLE', severity: 'warning', heuristic: true, message: `No plays before turn ${first}: the cheapest cards are ${names(db, ids.filter((id) => db.get(id)?.cost === first))}.`, cardIds: ids.filter((id) => db.get(id)?.cost === first) });
    }
  }
  for (const u of unsupported) out.push({ code: 'DEPENDENCY_MISSING', severity: 'warning', heuristic: true, message: `${nameOf(db, u.defId)} needs ${u.axes.map((a) => AXIS_BY_ID.get(a)?.label.toLowerCase() ?? a).join(' or ')}; none of the other cards provides it.`, cardIds: [u.defId] });
  for (const u of unreachable) out.push({ code: 'DEPENDENCY_MISSING', severity: 'warning', heuristic: true, message: `${nameOf(db, u.defId)}: ${u.why}`, cardIds: [u.defId] });
  return out;
}

export function rateDeck(deck: Deck, ctx: EngineContext): DeckRating {
  const db = ctx.db;
  const ids = deckIds(deck, db);
  const violations = validateDeck(deck, db, ctx.owned);
  const legal = isLegal(violations);
  const count = Array.isArray(deck?.cards) ? deck.cards.length : 0;
  const complete = count === SIZE && ids.length === SIZE;
  const f = Math.min(1, ids.length / SIZE);
  const known: Deck = { ...deck, cards: ids.map((defId) => ({ defId, locked: false })) };
  const plans = detectPlans(known, ctx);
  const stats = pairStats(db, ids);
  const c: Ctx = { db, ids, f, stats, plans, coh: cohesionOf(db, ids), core: archetypeCore(db, ids) };
  const unsupported = unsupportedPayoffs(db, ids, stats);
  const unreachable = unreachableRestrictions(db, ids);
  const subscores = [synergy(c), plan(c), energy(c, known), consistency(c), quality(c), resilience(c), coherence(c, unsupported, unreachable)];
  // Calibration pass: a plan matched in a deck whose cards cohere no more than random cards do is coincidental (random piles
  // that happen to hold two Moveable cards and a move payoff). Plan, consistency and resilience scale with cohesion up to the
  // bar random piles reach: nothing at COHESION.gateFrom of the bar, full credit at the bar (HEURISTIC).
  const pairScale = ids.length > 1 ? (ids.length * (ids.length - 1)) / 2 / 66 : 0;
  const bar = cohesionBar(db) * pairScale;
  const gate = bar > 0 ? clamp01((c.coh.total - COHESION.gateFrom * bar) / ((1 - COHESION.gateFrom) * bar)) : 0;
  if (gate < 1) {
    for (const s of subscores) {
      if (s.key !== 'plan' && s.key !== 'consistency' && s.key !== 'resilience') continue;
      s.value = clamp01(s.value * gate);
      s.fixes = [{ text: `Cohesion ${r1(c.coh.total)} is below ${r1(bar)}, what random piles of this pool reach: the plan's pieces barely interact, so this sub-score is scaled to ${pct(gate)} (heuristic).`, filter: null }, ...s.fixes].slice(0, MAX_FIXES);
    }
  }
  const raw = subscores.reduce((s, x) => s + x.weight * x.value, 0);
  let rating = Number.isFinite(raw) ? Math.round(raw) : 0;
  if (!legal) rating = Math.min(rating, ILLEGAL_CAP);
  return { rating: Math.max(0, Math.min(100, rating)), legal, complete, subscores, violations: [...violations, ...heuristicViolations(db, ids, unsupported, unreachable)] };
}

/** The primary-plan strength used by the builder's ablation check (re-exported for Task 8). */
export function primaryOf(deck: Deck, ctx: EngineContext): PlanMatch | null {
  return detectPlans(deck, ctx).primary;
}
