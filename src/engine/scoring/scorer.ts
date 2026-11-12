/**
 * Per-card score (spec §11): how much a card would add to the current deck, 0-100, with parts,
 * partner cards and plain-English reasons. In-deck cards are scored leave-one-out (against the deck
 * without them), so in-deck and out-of-deck cards share one scale; a duplicate copy is still gated.
 *
 * Parts (maxima from spec §11; shapes and constants in rating/constants.ts, all HEURISTIC):
 *  - synergy 30: edges into the deck, saturating, anti-synergy subtracted; edges into locked
 *    (build-around) cards count more; chosen theme axes add a bonus.
 *  - quality 20: the card's heuristic quality (spec §8.4).
 *  - plan 15: change in plan value (best plan strength + half the second) when the card is added.
 *  - energy 15: change in modelled energy spent and no-play odds on turns 2-4 (derived model).
 *  - meta (tuned) or novelty (brew) 15: inclusion rate among the deck's nearest meta lists, shrunk to
 *    the card's overall play rate (measured); or connected rarity plus unexplored strong pairs, zero
 *    for a card with no strong edge into the deck.
 *  - tech 5: meta share whose plans fold to the card's tech roles (measured shares), only while the
 *    deck has room for off-plan cards.
 */
import { energyModel } from '../maths/energy';
import { coplay, corpusOf, rarity } from '../novelty/clusters';
import { deckIds, nearestLists } from '../novelty/novelty';
import { detectPlans, matchesAny, matchPlan } from '../plans/detect';
import { edgeLabel, nameOf, roleFieldShare } from '../rating/deck';
import { COHERENCE, ENERGY, SCORE, SCORE_MAX } from '../rating/constants';
import { gateFor } from '../rules/validate';
import type { Card, CardDb, CardScore, Deck, EngineContext, EnergyReport, PlanMatch, ScorePart } from '../types';

const clamp01 = (x: number): number => (Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0);
const pct = (x: number): string => `${Math.round(x * 100)}%`;
const r1 = (x: number): string => (Math.round(x * 10) / 10).toFixed(1);

interface Base {
  ids: string[];
  set: Set<string>;
  locked: Set<string>;
  deck: Deck;
  plans: ReturnType<typeof detectPlans>;
  planValue: number;
  energy: EnergyReport;
  offPlan: number;
  near: { lists: number[]; o1: number } | null;
}

const deckOfIds = (deck: Deck, ids: readonly string[], locked: ReadonlySet<string>): Deck =>
  ({ ...deck, cards: ids.map((defId) => ({ defId, locked: locked.has(defId) })) });

/** Plan value: the best plan's strength plus half the second's (over all families found). */
function valueOf(all: readonly PlanMatch[]): number {
  const s = all.map((m) => m.strength).sort((a, b) => b - a);
  return (s[0] ?? 0) + 0.5 * (s[1] ?? 0);
}

const noPlay = (e: EnergyReport): number => ((e.pNoPlay[2] ?? 0) + (e.pNoPlay[3] ?? 0) + (e.pNoPlay[4] ?? 0)) / 3;

export function createScorer(deck: Deck, ctx: EngineContext): { score(card: Card): CardScore; scoreAll(filter?: (c: Card) => boolean): CardScore[] } {
  const db: CardDb = ctx.db;
  const brew = deck?.buildMode === 'brew';
  const themes = Array.isArray(deck?.themes) ? deck.themes : [];
  const allIds = deckIds(deck, db);
  const locked = new Set((Array.isArray(deck?.cards) ? deck.cards : []).filter((c) => c?.locked).map((c) => c.defId));
  const corpus = corpusOf(db);
  const meta = db.meta();
  const roleShare = roleFieldShare(db);
  const bases = new Map<string, Base>();
  const energyBySig = new Map<string, EnergyReport>();

  function baseFor(without: string | null): Base {
    const key = without ?? '';
    const hit = bases.get(key);
    if (hit) return hit;
    const ids = without ? allIds.filter((id) => id !== without) : allIds;
    const d = deckOfIds(deck, ids, locked);
    const plans = detectPlans(d, ctx);
    let near: Base['near'] = null;
    if (!brew && meta.info()) {
      const lists = meta.lists();
      if (ids.length === 0) {
        near = { lists: [], o1: 0 };
      } else {
        const { o1 } = nearestLists(db, ids, 0);
        const shared = new Map<number, number>();
        for (const id of ids) for (const i of meta.listsWith(id)) shared.set(i, (shared.get(i) ?? 0) + 1);
        const floor = Math.max(1, o1 - SCORE.nearSlack);
        const chosen = [...shared].filter(([, s]) => s >= floor).sort((x, y) => y[1] - x[1] || lists[y[0]]!.games - lists[x[0]]!.games).slice(0, SCORE.nearLists).map(([i]) => i);
        near = { lists: chosen, o1 };
      }
    }
    const b: Base = { ids, set: new Set(ids), locked, deck: d, plans, planValue: valueOf(plans.all), energy: energyModel(d, db, undefined, ENERGY.scoreGames), offPlan: plans.offPlan.length, near };
    bases.set(key, b);
    return b;
  }

  function score(card: Card): CardScore {
    const defId = card && typeof card.defId === 'string' ? card.defId : '';
    const inDeck = allIds.includes(defId);
    const base = baseFor(inDeck ? defId : null);
    // Leave-one-out: an in-deck card is gated against the deck without it (only a duplicate copy stays).
    const cards = Array.isArray(deck?.cards) ? deck.cards : [];
    const first = inDeck ? cards.findIndex((x) => x?.defId === defId) : -1;
    const gateDeck = inDeck ? { ...deck, cards: cards.filter((_, i) => i !== first) } : deck;
    const gate = gateFor(card, gateDeck, db, ctx.owned);
    const zero = (): ScorePart[] => (['synergy', 'quality', 'plan', 'energy', brew ? 'novelty' : 'meta', 'tech'] as const).map((key) => ({ key, points: 0, max: SCORE_MAX[key] }));
    if (gate) return { defId, score: 0, parts: zero(), reasons: [gate.message], partners: [], gate };
    const c = db.get(defId)!;
    const f = db.features(defId);
    const reasons: string[] = [];

    // Synergy.
    const partners: CardScore['partners'] = [];
    let pos = 0;
    let anti = 0;
    let strongInto = 0;
    const antiNames: string[] = [];
    for (const e of db.edges(defId)) {
      const other = e.a === defId ? e.b : e.a;
      if (other === defId || !base.set.has(other)) continue;
      const boost = base.locked.has(other) ? SCORE.buildAroundBoost : 1;
      // The pair score is already net (synergy - anti): count its sign once.
      if (e.score > 0) pos += e.score * boost;
      if (e.score < 0) {
        anti += -e.score;
        antiNames.push(`${nameOf(db, other)} (${edgeLabel(e, 'anti')})`);
      }
      if (e.strong) strongInto++;
      if (Math.abs(e.score) >= SCORE.partnerMin) partners.push({ defId: other, score: e.score, reason: edgeLabel(e, e.score >= 0 ? 'synergy' : 'anti') });
    }
    const themeHits = themes.filter((t) => { const a = f?.axes[t]; return !!a && (a.e >= 0.5 || a.p >= 0.5); });
    pos += SCORE.themeBonus * themeHits.length;
    const k = SCORE.synergySaturation;
    const synergy = Math.max(0, SCORE_MAX.synergy * ((1 - Math.exp(-pos / k)) - (1 - Math.exp(-anti / k))));
    partners.sort((a, b) => Math.abs(b.score) - Math.abs(a.score) || (a.defId < b.defId ? -1 : 1));
    const shown = partners.slice(0, SCORE.partners);
    if (shown.some((p) => p.score > 0)) reasons.push(`Works with ${shown.filter((p) => p.score > 0).map((p) => `${nameOf(db, p.defId)} (${p.reason}, ${r1(p.score)})`).join('; ')}${strongInto ? `: ${strongInto} strong edge${strongInto === 1 ? '' : 's'} into the deck` : ''} (heuristic).`);
    else if (base.ids.length) reasons.push(`No interaction of ${SCORE.partnerMin} or more with ${base.ids.length} deck cards (heuristic).`);
    if (antiNames.length) reasons.push(`Anti-synergy with ${antiNames.join('; ')}: lowers the score (heuristic).`);
    if (themeHits.length) reasons.push(`On the chosen theme${themeHits.length > 1 ? 's' : ''} ${themeHits.join(', ')}.`);

    // Quality.
    const q = f?.quality ?? 50;
    const quality = SCORE_MAX.quality * clamp01(q / 100);
    reasons.push(`Card quality ${Math.round(q)} of 100: ${c.cost}-Cost, ${c.power} Power${f ? `, stat ${r1(f.qualityParts.stat)}, text ${r1(f.qualityParts.text)}, measured ${r1(f.qualityParts.measured)}` : ''} (heuristic).`);

    // Plan: re-match only the families the card belongs to.
    const withCard = deckOfIds(deck, [...base.ids, defId], base.locked);
    const after: PlanMatch[] = [];
    let joined: PlanMatch | null = null;
    for (const plan of db.plans()) {
      const own = matchesAny(c, f, db, plan.enablerTraits) || matchesAny(c, f, db, plan.payoffTraits);
      if (own) {
        const m = matchPlan(plan, withCard, db);
        if (m) {
          after.push(m);
          if (!joined || m.strength > joined.strength) joined = m;
        }
      } else {
        const m = base.plans.all.find((x) => x.planId === plan.id);
        if (m) after.push(m);
      }
    }
    const delta = valueOf(after) - base.planValue;
    const planPts = SCORE_MAX.plan * clamp01(delta / SCORE.planDeltaFull);
    if (joined) {
      const role = joined.payoffs.includes(defId) ? 'payoff' : 'enabler';
      reasons.push(`${role === 'payoff' ? 'Payoff' : 'Enabler'} for ${joined.name} with ${joined.enablers.concat(joined.payoffs).filter((x) => x !== defId).map((x) => nameOf(db, x)).join(', ') || 'no other card yet'}: plan value ${delta >= 0 ? '+' : ''}${r1(delta)}, assembly ${pct(joined.assembly)} by turn ${joined.keyTurn} (heuristic).`);
    } else if (base.plans.primary) {
      reasons.push(`Not part of ${base.plans.primary.name}.`);
    }

    // Energy (derived model; cached by the cost signature of the deck plus this card).
    const sig = `${c.cost}/${f?.model.selfDiscount ?? 0}/${f?.model.extraEnergy ?? 0}/${f?.traits.includes('energy_max_player') ? 1 : 0}/${inDeck ? defId : ''}`;
    let eAfter = energyBySig.get(sig);
    if (!eAfter) energyBySig.set(sig, (eAfter = energyModel(withCard, db, undefined, ENERGY.scoreGames)));
    const dSpent = eAfter.expectedSpent - base.energy.expectedSpent;
    const dNoPlay = noPlay(eAfter) - noPlay(base.energy);
    const energy = SCORE_MAX.energy * clamp01(0.5 + (dSpent - 3 * dNoPlay) / (2 * SCORE.energyDeltaFull));
    reasons.push(`Energy: modelled spend ${r1(base.energy.expectedSpent)} -> ${r1(eAfter.expectedSpent)} of 21, no-play odds on turns 2-4 ${pct(noPlay(base.energy))} -> ${pct(noPlay(eAfter))} (derived model).`);

    // Meta (tuned) or novelty (brew).
    let mn = 0;
    const share = corpus.listShare(defId);
    if (brew) {
      const strongEdges = db.edges(defId).filter((e) => e.strong && base.set.has(e.a === defId ? e.b : e.a) && e.a !== e.b);
      if (strongEdges.length === 0) {
        reasons.push(`Novelty: 0, ${c.name} has no strong edge into the deck, and rarity alone is not creative.`);
      } else {
        let bestU = 0;
        let bestPair = '';
        for (const e of strongEdges) {
          const ev = coplay(corpus, [e.a, e.b]);
          if (ev.unexplored > bestU || !bestPair) {
            bestU = ev.unexplored;
            bestPair = nameOf(db, e.a === defId ? e.b : e.a);
          }
        }
        const rar = rarity(share);
        mn = SCORE_MAX.novelty * clamp01(SCORE.noveltyRarity * rar + SCORE.noveltyUnexplored * bestU);
        reasons.push(`Novelty: in ${pct(share)} of tracked lists (rarity ${r1(rar)}), strong pair with ${bestPair} unexplored ${r1(bestU)}${corpus.withheld ? '; unexplored claims withheld: thin corpus' : ''}.`);
      }
    } else if (!meta.info()) {
      reasons.push('Meta: no meta snapshot synced, so no inclusion rate.');
    } else {
      const near = base.near!;
      const n = near.lists.length;
      const hits = near.lists.filter((i) => meta.lists()[i]!.cards.includes(defId)).length;
      const rate = (hits + SCORE.inclusionPrior * share) / (n + SCORE.inclusionPrior);
      mn = SCORE_MAX.meta * clamp01(rate / SCORE.inclusionFull);
      reasons.push(n ? `Meta: in ${hits} of the ${n} closest meta lists (sharing ${Math.max(1, near.o1 - SCORE.nearSlack)}+ cards with the deck); ${pct(share)} of all lists; shrunk rate ${pct(rate)} (measured, shrinkage heuristic).` : `Meta: in ${pct(share)} of all tracked lists (measured).`);
    }

    // Tech.
    let tech = 0;
    const roles = f?.techRoles ?? [];
    if (roles.length) {
      const onPlan = base.plans.primary && (base.plans.primary.enablers.includes(defId) || base.plans.primary.payoffs.includes(defId));
      const room = base.offPlan < COHERENCE.offPlanAllowed || onPlan;
      const best = roles.map((r) => ({ r, s: roleShare.get(r) })).sort((a, b) => (b.s?.share ?? 0) - (a.s?.share ?? 0))[0]!;
      const sh = best.s?.share ?? 0;
      if (!room) reasons.push(`Tech (${roles.join(', ')}): the deck already has ${base.offPlan} off-plan cards, no room for tech.`);
      else {
        tech = SCORE_MAX.tech * clamp01(sh / SCORE.techShareFull);
        reasons.push(`Tech (${best.r}): answers ${pct(sh)} of meta games${best.s?.archetypes.length ? ` (${best.s.archetypes.slice(0, 3).join(', ')})` : ''} (measured shares, plan tags heuristic).`);
      }
    }

    const raw: ScorePart[] = [
      { key: 'synergy', points: synergy, max: SCORE_MAX.synergy },
      { key: 'quality', points: quality, max: SCORE_MAX.quality },
      { key: 'plan', points: planPts, max: SCORE_MAX.plan },
      { key: 'energy', points: energy, max: SCORE_MAX.energy },
      { key: brew ? 'novelty' : 'meta', points: mn, max: SCORE_MAX[brew ? 'novelty' : 'meta'] },
      { key: 'tech', points: tech, max: SCORE_MAX.tech },
    ];
    const parts = raw.map((p) => ({ ...p, points: Math.round(p.points * 10) / 10 }));
    const total = parts.reduce((s, p) => s + p.points, 0);
    return { defId, score: Math.max(0, Math.min(100, Math.round(total))), parts, reasons, partners: shown, gate: null };
  }

  return {
    score,
    scoreAll: (filter) => {
      const out: CardScore[] = [];
      for (const c of db.released()) if (!filter || filter(c)) out.push(score(c));
      return out.sort((a, b) => b.score - a.score || (a.defId < b.defId ? -1 : 1));
    },
  };
}
