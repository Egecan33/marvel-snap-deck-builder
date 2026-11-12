/**
 * Theorycraft lines (spec §15; docs/research/deck-theory-and-creativity.md §2-§3, mechanics.md §1.4).
 *
 * Deterministic: every line names cards of the deck (field and tech lines also name cards outside
 * it), carries its reason, a probability where one exists, and its provenance:
 *  - `derived`   exact draw maths (theory §1.2) or the seeded energy model (theory §1.3);
 *  - `measured`  never alone here: meta shares are measured, but every line that uses them also
 *                rests on a heuristic plan or tech reading, so those lines are `heuristic`;
 *  - `heuristic` plan membership, sequencing rules, location shapes, tech fit and replacements.
 *
 * Inputs are plans, maths, features, the interaction network and synced meta only (no scoring).
 * Never throws: unknown cards are ignored, an empty deck has no lines, no meta gives no field or tech.
 */
import { TECH_ROLES } from '../features/tech';
import { costPred, effs, powerPred } from '../features/traits';
import { energyModel, TURNS } from '../maths/energy';
import { pAtLeastOne } from '../maths/hypergeo';
import { detectPlans, drawAdjust, matchesAny, matchPlan, nameList, PLAN_THRESHOLD } from '../plans/detect';
import type { Card, CardDb, CardEdge, CardFeatures, Deck, EngineContext, Line, LineReport, MetaArchetype, PlanDef, PlanMatch, PlanReport, TechRole } from '../types';

/** HEURISTIC caps that keep the report readable. */
const MAX_PIECE_LINES = 8;
const MAX_SEQUENCE_LINES = 10;
const MAX_PARTNERS_PER_ACTOR = 3;
const MAX_PACKAGES = 4;
const MAX_ONE_AWAY = 5;
const FIELD_ARCHETYPES = 5;
const TECH_ROLES_SHOWN = 3;
const TECH_CARDS_PER_ROLE = 2;
const MAX_ANTI_RISKS = 5;
/** HEURISTIC: a plan's fold is a risk when the tech holders appear in at least this share of meta lists. */
export const FOLD_RISK_SHARE = 0.15;

const pct = (x: number): string => `${Math.round(x * 1000) / 10}%`;
const uniq = <T>(xs: readonly T[]): T[] => [...new Set(xs)];
const roleLabel = (role: TechRole): string => TECH_ROLES.find((r) => r.id === role)?.label ?? role;

interface View {
  db: CardDb;
  deck: Deck;
  cards: Card[];                      // unique known cards, deck order
  ids: Set<string>;
  plans: PlanReport;
  name: (id: string) => string;
  f: (id: string) => CardFeatures | undefined;
}

function viewOf(deck: Deck, ctx: EngineContext): View {
  const db = ctx.db;
  const seen = new Set<string>();
  const cards: Card[] = [];
  for (const dc of deck.cards) {
    if (seen.has(dc.defId)) continue;
    seen.add(dc.defId);
    const c = db.get(dc.defId);
    if (c) cards.push(c);
  }
  return {
    db, deck, cards,
    ids: new Set(cards.map((c) => c.defId)),
    plans: detectPlans(deck, ctx),
    name: (id) => db.get(id)?.name ?? id,
    f: (id) => db.features(id),
  };
}

const names = (v: View, ids: readonly string[], joiner = 'and'): string => {
  const ns = ids.map(v.name);
  return joiner === 'and' ? nameList(ns) : ns.length <= 1 ? nameList(ns) : `${ns.slice(0, -1).join(', ')} or ${ns[ns.length - 1]}`;
};
const pieces = (m: PlanMatch | null): string[] => (m ? [...m.enablers, ...m.payoffs] : []);
const planDef = (db: CardDb, id: string): PlanDef | undefined => db.plans().find((p) => p.id === id);

// ---------------------------------------------------------------------------------------------
// Turn plan (derived from the energy model)

function turnLines(v: View): Line[] {
  const energy = energyModel(v.deck, v.db);
  const primary = v.plans.primary;
  const cheapest = Math.min(...v.cards.map((c) => c.cost));
  const out: Line[] = [];
  for (let t = 1; t <= TURNS; t++) {
    const plays = energy.likelyPlays[t] ?? [];
    const pPlay = Math.min(1, Math.max(0, 1 - (energy.pNoPlay[t] ?? 1)));
    let text: string;
    let cardIds: string[];
    if (plays.length) {
      const byCost = new Map<number, string[]>();
      for (const id of plays) {
        const c = v.db.get(id)!;
        byCost.set(c.cost, [...(byCost.get(c.cost) ?? []), id]);
      }
      const groups = [...byCost].sort((a, b) => a[0] - b[0]).map(([cost, ids]) => `${cost}-Cost ${names(v, ids, 'or')}`);
      const discounted = plays.filter((id) => v.db.get(id)!.cost > t);
      text = `Turn ${t}: the most frequent play in the model is from ${groups.join('; ')} (a play in ${pct(pPlay)} of games)`;
      if (discounted.length) text += `; ${names(v, discounted)} ${discounted.length > 1 ? 'cost' : 'costs'} less by ${discounted.length > 1 ? 'their' : 'its'} own text`;
      cardIds = [...plays];
    } else {
      const low = v.cards.filter((c) => c.cost === cheapest).map((c) => c.defId);
      text = `Turn ${t}: no play in ${pct(1 - pPlay)} of games; the cheapest cards are ${names(v, low)} (${cheapest}-Cost)`;
      cardIds = low;
    }
    if (primary) {
      const onCurve = pieces(primary).filter((id) => v.db.get(id)!.cost === t);
      if (onCurve.length) {
        text += `. ${primary.name}: ${names(v, onCurve)} ${onCurve.length > 1 ? 'land' : 'lands'} on curve`;
        cardIds.push(...onCurve);
      }
      if (t === primary.keyTurn) {
        text += `. Key turn of ${primary.name}: assembled in ${pct(primary.assembly)} of games`;
        cardIds.push(...primary.payoffs);
      }
    }
    out.push({
      kind: 'turn', text, cardIds: uniq(cardIds), probability: pPlay, provenance: 'derived',
      reason: 'Energy model: seeded Monte Carlo of greedy play over the deck costs, 4,000 games (theory §1.3); it does not hold cards on purpose or know board space.',
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Assembly (exact draw maths over heuristic plan membership)

function assemblyLines(v: View): Line[] {
  const out: Line[] = [];
  for (const m of [v.plans.primary, v.plans.secondary]) {
    if (!m) continue;
    const def = planDef(v.db, m.planId);
    if (!def) continue;
    const { extra } = drawAdjust(v.deck, v.db, m.keyTurn);
    const want = [m.enablers.length ? `one of ${names(v, m.enablers, 'or')}` : '', m.payoffs.length ? `one of ${names(v, m.payoffs, 'or')}` : ''].filter(Boolean).join(' and ');
    out.push({
      kind: 'assembly',
      text: `${m.name} by turn ${m.keyTurn}: ${pct(m.assembly)} to have seen ${want}${extra ? ` (counting ${extra} extra card${extra > 1 ? 's' : ''} seen from draw effects)` : ''}`,
      cardIds: pieces(m), probability: m.assembly, provenance: 'derived',
      reason: `Exact hypergeometric odds of ${3 + m.keyTurn + extra} cards seen from ${Math.max(12, v.cards.length)} (theory §1.2); which cards are enablers and payoffs is the heuristic of plans.json.`,
    });
    for (const id of pieces(m).slice(0, MAX_PIECE_LINES)) {
      const side = m.enablers.includes(id) ? 'enabler' : 'payoff';
      const subs = (side === 'enabler' ? m.enablers : m.payoffs).filter((x) => x !== id);
      const without: Deck = { ...v.deck, cards: v.deck.cards.filter((c) => c.defId !== id) };
      const after = matchPlan(def, without, v.db)?.assembly ?? 0;
      const rest = subs.length
        ? `${names(v, subs)} still ${subs.length > 1 ? 'cover' : 'covers'} the ${side} role`
        : `no other ${side} in the deck, so the plan stops`;
      out.push({
        kind: 'assembly',
        text: `Without ${v.name(id)} (${side}): ${m.name} falls from ${pct(m.assembly)} to ${pct(after)} by turn ${m.keyTurn}; ${rest}`,
        cardIds: [id, ...subs], probability: after, provenance: 'derived',
        reason: `Same draw maths with ${v.name(id)} removed from the deck.`,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Sequencing (HEURISTIC rules read from clause structure; mechanics §1.4)

interface Seq { first: string; then: string; here: boolean; why: string; rank: number; extra?: string[] }

const isCarrier = (f: CardFeatures | undefined): boolean => !!f?.clauses.some((c) => c.trigger === 'on_reveal' && c.effects.length > 0);
const quoteOf = (card: Card, sentence: string): string => `${card.name}: "${sentence.trim()}"`;
/** Does B pass the cost or Power filter named in A's sentence? No filter passes. */
function passesFilter(sentence: string, b: Card): boolean {
  const cp = costPred(sentence);
  if (cp && !cp.test(b.cost)) return false;
  const pp = powerPred(sentence);
  if (pp && !pp.test(b.power)) return false;
  return true;
}
const hereIn = (target: string, sentence: string): boolean => target === 'own_here' || /\bhere\b|this location/.test(sentence);

/** Ordered pairs where A acts on B (A is the actor of the rule). */
function sequenceRules(v: View, A: Card, B: Card, edge: CardEdge | undefined): Seq[] {
  const fa = v.f(A.defId);
  const fb = v.f(B.defId);
  if (!fa || !fb || B.isSkill && !isCarrier(fb)) return [];
  const out: Seq[] = [];
  const synergy = edge?.synergy ?? 0;
  const rank = edge?.score ?? 0;
  // Broad effects (rules 4-6) need a synergy reason read from text, not only a cost or axis guess.
  const textTie = synergy > 0 && !!edge?.reasons.some((r) => r.kind === 'synergy' && !r.heuristic);

  // 1. On Reveal repeaters (Wong, Joaquin Torres, Odin): the carrier must reveal where the repeater is.
  for (const h of effs(fa.clauses, /^repeat_on_reveal$/, /^(?!self$)/)) {
    if (!isCarrier(fb) || !passesFilter(h.clause.text, B) || /released before/.test(h.clause.text)) continue;
    const here = hereIn(h.effect.target, h.clause.text);
    if (h.clause.trigger === 'on_reveal') {
      out.push({ first: B.defId, then: A.defId, here, rank: rank + 0.5, why: `${A.name}'s On Reveal repeats the On Reveals already in play (${quoteOf(A, h.clause.text)})` });
    } else {
      out.push({ first: A.defId, then: B.defId, here, rank: rank + 0.5, why: `${A.name} must be in play before ${B.name} reveals (${quoteOf(A, h.clause.text)})` });
    }
  }
  // 2. Copiers of the last card played (Absorbing Man): the copied card goes first.
  for (const h of effs(fa.clauses, /^(copy_text|repeat_on_reveal|copy_card)$/)) {
    if (!(h.clause.conditions.includes('last_played_has_keyword') || /last card you played/i.test(h.clause.text))) continue;
    const wantsOngoing = /Ongoing/.test(h.clause.text) && !/On Reveal/.test(h.clause.text);
    const fits = wantsOngoing ? fb.clauses.some((c) => c.trigger === 'ongoing') : isCarrier(fb);
    if (!fits || synergy <= 0 && !isCarrier(fb)) continue;
    out.push({ first: B.defId, then: A.defId, here: false, rank: rank + 0.4, why: `${A.name} copies the last card you played (${quoteOf(A, h.clause.text)})` });
  }
  // 3. Next-card effects (Shuri): the effect goes first, the big card next, at its location when it says so.
  for (const h of effs(fa.clauses, /./, /^own_next_played$/)) {
    if (B.isSkill || !passesFilter(h.clause.text, B)) continue;
    const big = /Power/.test(h.clause.text);
    if (big && B.power < 4) continue;   // HEURISTIC: a Power effect on the next card is worth it on 4+ Power
    out.push({ first: A.defId, then: B.defId, here: /this location|here/.test(h.clause.text), rank: rank + B.power / 20, why: `${A.name} acts on the next card you play (${quoteOf(A, h.clause.text)})` });
  }
  // 4. Cost reducers before their targets, when the network ties the two cards.
  for (const h of effs(fa.clauses, /^cost_reduce$/, /^(own_hand|own_deck|own)$/)) {
    // A card that generates a random card reduces that card ("Give it -2 Cost"), not one you choose.
    if (h.clause.trigger === 'static_cost' || fa.traits.includes('sel:random') || !textTie) continue;
    if (B.cost <= 1 || !passesFilter(h.clause.text, B)) continue;
    out.push({ first: A.defId, then: B.defId, here: false, rank, why: `${A.name} lowers costs before ${B.name} is played (${quoteOf(A, h.clause.text)})` });
  }
  // 5. On Reveals that act on your cards already in play (Carnage, buffs here): the target goes first.
  for (const h of effs(fa.clauses, /^(destroy|buff|move|bounce|power_double|merge|afflict|copy_text)$/, /^(own_here|own_anywhere|own_other_locations)$/, /^on_reveal$/)) {
    if (!textTie || !passesFilter(h.clause.text, B)) continue;
    out.push({ first: B.defId, then: A.defId, here: h.effect.target === 'own_here', rank, why: `${A.name}'s On Reveal acts on your cards already in play (${quoteOf(A, h.clause.text)})` });
  }
  // 6. Triggers on your later plays (Zombie Scarlet Witch, "when you play a card here"): the trigger goes first.
  for (const c of fa.clauses) {
    if (!/^(on_own_play|on_any_play)$/.test(c.trigger) || !c.effects.length || !textTie) continue;
    out.push({ first: A.defId, then: B.defId, here: /\bhere\b/.test(c.text), rank, why: `${A.name} triggers on cards you play after it (${quoteOf(A, c.text)})` });
  }
  return out;
}

/** Cards that put bodies on your side (summons, generated cards on board). */
const addsBodies = (f: CardFeatures | undefined): boolean => !!f && f.traits.some((t) => /^(summon_own|gen_board_own|gen_board_all)$/.test(t));

function sequencingLines(v: View): Line[] {
  const seqs: Seq[] = [];
  for (const A of v.cards) {
    const mine: Seq[] = [];
    for (const B of v.cards) {
      if (A.defId === B.defId) continue;
      mine.push(...sequenceRules(v, A, B, v.db.edge(A.defId, B.defId)));
    }
    mine.sort((x, y) => y.rank - x.rank || (x.first + x.then).localeCompare(y.first + y.then));
    seqs.push(...mine.slice(0, MAX_PARTNERS_PER_ACTOR));
  }
  // Full or empty side conditions: the fillers (or nothing) go first.
  for (const B of v.cards) {
    const fb = v.f(B.defId);
    if (!fb) continue;
    const conds = new Set(fb.clauses.flatMap((c) => c.conditions));
    const fillers = v.cards.filter((c) => c.defId !== B.defId && addsBodies(v.f(c.defId))).map((c) => c.defId);
    const sentence = fb.clauses.find((c) => c.conditions.some((k) => /side_full|alone_here|own_empty_location/.test(k)))?.text ?? '';
    if (conds.has('own_side_full') || conds.has('both_sides_full')) {
      seqs.push({
        first: fillers[0] ?? B.defId, then: B.defId, here: true, rank: 0.3, extra: fillers.slice(1),
        why: fillers.length
          ? `${B.name} needs a full side (${quoteOf(B, sentence)}); ${names(v, fillers)} ${fillers.length > 1 ? 'add' : 'adds'} bodies to fill it first`
          : `${B.name} needs a full side (${quoteOf(B, sentence)}): play it as your fourth card there`,
      });
    }
    if (conds.has('alone_here') || conds.has('own_empty_location')) {
      seqs.push({
        first: B.defId, then: B.defId, here: false, rank: 0.3, extra: fillers,
        why: `${B.name} wants a location to itself (${quoteOf(B, sentence)})${fillers.length ? `; play it before ${names(v, fillers)} ${fillers.length > 1 ? 'add' : 'adds'} bodies there` : ''}`,
      });
    }
  }
  const seen = new Set<string>();
  const out: Line[] = [];
  for (const s of seqs.sort((x, y) => y.rank - x.rank || (x.first + x.then).localeCompare(y.first + y.then))) {
    const key = `${s.first}>${s.then}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const text = s.extra
      ? s.why
      : `Play ${v.name(s.first)} before ${v.name(s.then)}${s.here ? ' at the same location' : ''}: ${s.why}`;
    out.push({
      kind: 'sequence', text, cardIds: uniq([s.first, s.then, ...(s.extra ?? [])]), probability: null, provenance: 'heuristic',
      reason: 'Order read from clause structure (trigger and target of the acting card) and, for broad effects, a synergy edge between the two cards (mechanics §1.4).',
    });
    if (out.length >= MAX_SEQUENCE_LINES) break;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Locations (HEURISTIC shapes)

function locationLines(v: View): Line[] {
  const out: Line[] = [];
  const reason = 'Shape read from card traits and location-scoped edges (spec §15); a heuristic summary, not a simulation.';
  const p = v.plans.primary;
  if (p) out.push({ kind: 'location', text: `${p.name}: ${p.takesLocations}`, cardIds: pieces(p), probability: null, provenance: 'heuristic', reason: `Template of the plan family in plans.json (theory §2), filled with the deck's cards.` });

  const tall: string[] = [];
  const pairs: string[] = [];
  for (let i = 0; i < v.cards.length; i++) {
    for (let j = i + 1; j < v.cards.length; j++) {
      const e = v.db.edge(v.cards[i]!.defId, v.cards[j]!.defId);
      if (!e || !e.strong || !e.sameLocation) continue;
      tall.push(e.a, e.b);
      pairs.push(`${v.name(e.a)} + ${v.name(e.b)}`);
    }
  }
  if (tall.length) {
    out.push({ kind: 'location', text: `Tall and hold: ${names(v, uniq(tall))} only interact at a shared location (${pairs.slice(0, 4).join(', ')}); win that lane big and spread the rest`, cardIds: uniq(tall), probability: null, provenance: 'heuristic', reason });
  }
  const wide = v.cards.filter((c) => addsBodies(v.f(c.defId))).map((c) => c.defId);
  if (wide.length >= 2) out.push({ kind: 'location', text: `Wide: ${names(v, wide)} add bodies, so the deck can contest all three locations`, cardIds: wide, probability: null, provenance: 'heuristic', reason });
  const movers = v.cards.filter((c) => { const a = v.f(c.defId)?.axes.move; return !!a && (a.e >= 1 || a.p >= 1); }).map((c) => c.defId);
  if (movers.length >= 2) out.push({ kind: 'location', text: `Move: ${names(v, movers)} can shift Power after the opponent commits`, cardIds: movers, probability: null, provenance: 'heuristic', reason });
  const lockers = v.cards.filter((c) => v.f(c.defId)?.techRoles.includes('lockdown')).map((c) => c.defId);
  if (lockers.length) out.push({ kind: 'location', text: `Lockdown: ${names(v, lockers)} close${lockers.length > 1 ? '' : 's'} a location; win it before closing it`, cardIds: lockers, probability: null, provenance: 'heuristic', reason });
  for (const c of v.cards) {
    const r = v.f(c.defId)?.restriction;
    if (r) out.push({ kind: 'location', text: `${c.name} has a play restriction: "${r}"`, cardIds: [c.defId], probability: null, provenance: 'heuristic', reason: 'Restriction sentence read from the card text (mechanics §1.4); check it is reachable with this deck.' });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Packages and one card away

function packageLines(v: View): Line[] {
  const out: Line[] = [];
  for (const m of v.plans.all) {
    const parts = [m.enablers.length ? `enablers ${names(v, m.enablers)}` : '', m.payoffs.length ? `payoffs ${names(v, m.payoffs)}` : ''].filter(Boolean).join('; ');
    out.push({
      kind: 'package', text: `${m.name} is complete: ${parts} (${pct(m.assembly)} by turn ${m.keyTurn})`,
      cardIds: pieces(m), probability: m.assembly, provenance: 'heuristic',
      reason: 'The deck holds the minimum enablers and payoffs of this plans.json family (heuristic); odds are exact draw maths.',
    });
  }
  // Strong-edge groups of the deck (connected components of size 2 or more).
  const parent = new Map<string, string>(v.cards.map((c) => [c.defId, c.defId]));
  const find = (x: string): string => (parent.get(x) === x ? x : find(parent.get(x)!));
  const labels = new Map<string, string[]>();
  for (let i = 0; i < v.cards.length; i++) {
    for (let j = i + 1; j < v.cards.length; j++) {
      const e = v.db.edge(v.cards[i]!.defId, v.cards[j]!.defId);
      if (!e?.strong) continue;
      parent.set(find(e.a), find(e.b));
      const best = e.reasons.find((r) => r.kind === 'synergy');
      if (best) labels.set(`${e.a}|${e.b}`, [e.a, e.b, best.label]);
    }
  }
  const groups = new Map<string, string[]>();
  for (const c of v.cards) {
    const r = find(c.defId);
    groups.set(r, [...(groups.get(r) ?? []), c.defId]);
  }
  const comps = [...groups.values()].filter((g) => g.length >= 2).sort((x, y) => y.length - x.length || x[0]!.localeCompare(y[0]!));
  for (const g of comps.slice(0, MAX_PACKAGES)) {
    const set = new Set(g);
    const why = [...labels.values()].filter(([a, b]) => set.has(a!) && set.has(b!)).slice(0, 2).map((x) => x[2]);
    out.push({
      kind: 'package', text: `Strong interactions tie ${names(v, g)} together: ${why.join('; ')}`,
      cardIds: g, probability: null, provenance: 'heuristic',
      reason: 'Connected cards of the interaction network with strong edges (score 0.5 or more, spec §8.3; heuristic weights, audited at 88% strict precision).',
    });
  }
  return out;
}

function fitInDeck(v: View, id: string): { fit: number; partner: string | null } {
  let fit = 0;
  let best: CardEdge | null = null;
  for (const c of v.cards) {
    const e = v.db.edge(id, c.defId);
    if (!e) continue;
    fit += e.score;
    if (e.score > 0 && (!best || e.score > best.score)) best = e;
  }
  const partner = best ? (best.a === id ? best.b : best.a) : null;
  return { fit, partner };
}

function candidateOk(v: View, ctx: EngineContext, c: Card): boolean {
  return c.cardClass === 'released' && !v.ids.has(c.defId) && (!ctx.owned || !!ctx.owned[c.defId]);
}

function oneAwayLines(v: View, ctx: EngineContext): Line[] {
  const have = new Set(v.plans.all.map((m) => m.planId));
  const out: Line[] = [];
  for (const plan of v.db.plans()) {
    if (have.has(plan.id)) continue;
    let e = 0;
    let p = 0;
    let dual = 0;
    const found: string[] = [];
    for (const c of v.cards) {
      const f = v.f(c.defId);
      const isE = matchesAny(c, f, v.db, plan.enablerTraits);
      const isP = matchesAny(c, f, v.db, plan.payoffTraits);
      if (isE && isP) dual++;
      else if (isE) e++;
      else if (isP) p++;
      if (isE || isP) found.push(c.defId);
    }
    if (!found.length) continue;
    let shortE = Math.max(0, plan.minEnablers - e);
    let shortP = Math.max(0, plan.minPayoffs - p);
    const useE = Math.min(dual, shortE);
    shortE -= useE;
    shortP = Math.max(0, shortP - (dual - useE));
    if (shortE + shortP !== 1) continue;
    const side = shortE ? 'enabler' : 'payoff';
    const patterns = shortE ? plan.enablerTraits : plan.payoffTraits;
    const cands = v.db.released()
      .filter((c) => candidateOk(v, ctx, c) && matchesAny(c, v.db.features(c.defId), v.db, patterns))
      .map((c) => ({ c, ...fitInDeck(v, c.defId), q: v.db.features(c.defId)?.quality ?? 0 }))
      .sort((x, y) => y.fit - x.fit || y.q - x.q || x.c.defId.localeCompare(y.c.defId))
      .slice(0, 2);
    if (!cands.length) continue;
    const top = cands[0]!;
    const withTop: Deck = { ...v.deck, cards: [...v.deck.cards, { defId: top.c.defId, locked: false }] };
    const after = matchPlan(plan, withTop, v.db);
    if (!after) continue;
    const cand = cands.map((x) => `${x.c.name}${x.partner ? ` (works with ${v.name(x.partner)})` : ''}`);
    out.push({
      kind: 'one-away',
      text: `${plan.name} is one card away: ${names(v, found)} ${found.length > 1 ? 'are' : 'is'} in the deck, one more ${side} is missing; ${cand.join(' or ')} would complete it (${pct(after.assembly)} by turn ${plan.keyTurn} with ${top.c.name})`,
      cardIds: found, probability: after.assembly, provenance: 'heuristic',
      reason: 'Plan minimums of plans.json (heuristic); candidates are released cards of the missing side ranked by edge scores into this deck, then card quality.',
    });
  }
  return out.sort((x, y) => (y.probability ?? 0) - (x.probability ?? 0) || x.text.localeCompare(y.text)).slice(0, MAX_ONE_AWAY);
}

// ---------------------------------------------------------------------------------------------
// Against the field and tech choices (synced meta; HEURISTIC plan reading)

const archetypePlanCache = new WeakMap<CardDb, Map<number, string | null>>();
/** The archetype's plan: its tagged `planId`, else the primary plan detected on its most-played list. */
function archetypePlan(db: CardDb, a: MetaArchetype): PlanDef | undefined {
  let perDb = archetypePlanCache.get(db);
  if (!perDb) archetypePlanCache.set(db, (perDb = new Map()));
  if (!perDb.has(a.id)) {
    const id = a.planId ?? detectPlans({ id: null, name: a.name, format: 'ranked', cards: a.sample.map((defId) => ({ defId, locked: false })), themes: [], buildMode: 'tuned' }, { db, owned: null }).primary?.planId ?? null;
    perDb.set(a.id, id);
  }
  const id = perDb.get(a.id);
  return id ? planDef(db, id) : undefined;
}

const hasMeta = (db: CardDb): boolean => !!db.meta().info() && db.meta().archetypes().length > 0;

function fieldLines(v: View): Line[] {
  if (!hasMeta(v.db)) return [];
  const info = v.db.meta().info()!;
  const mine = v.plans.primary;
  const myFolds = new Set(mine?.foldsTo.map((f) => f.role) ?? []);
  const myCore = mine ? mine.payoffs.length ? mine.payoffs : mine.enablers : [...v.cards].sort((a, b) => b.power - a.power || a.defId.localeCompare(b.defId)).slice(0, 2).map((c) => c.defId);
  const archetypes = [...v.db.meta().archetypes()].sort((x, y) => y.share - x.share || x.id - y.id).slice(0, FIELD_ARCHETYPES);
  return archetypes.map((a) => {
    const plan = archetypePlan(v.db, a);
    const answers = plan ? v.cards.filter((c) => v.f(c.defId)?.techRoles.some((r) => plan.foldsTo.includes(r))).map((c) => c.defId) : [];
    const theirs = uniq([...a.topCards, ...a.sample]).filter((id) => !!v.db.get(id) && v.f(id)?.techRoles.some((r) => myFolds.has(r)));
    const theirRoles = uniq(theirs.flatMap((id) => v.f(id)!.techRoles.filter((r) => myFolds.has(r)))).map(roleLabel);
    const ansRoles = plan ? uniq(answers.flatMap((id) => v.f(id)!.techRoles.filter((r) => plan.foldsTo.includes(r)))).map(roleLabel) : [];
    const head = `Against ${a.name} (${(a.share * 100).toFixed(1)}% of games; its plan: ${plan?.name ?? 'none detected'})`;
    const ans = answers.length
      ? `${names(v, answers)} ${answers.length > 1 ? 'answer' : 'answers'} it (${ansRoles.join(', ')})`
      : `none of your cards is a tech answer to it, so race it with ${names(v, myCore)}`;
    const hit = theirs.length
      ? `its ${names(v, theirs)} (${theirRoles.join(', ')}) ${theirs.length > 1 ? 'hit' : 'hits'} ${mine ? mine.name : 'your deck'}: hold ${names(v, myCore)} until ${theirs.length > 1 ? 'they are' : 'it is'} played, or split them over two locations`
      : `its usual cards carry no tech that ${mine ? mine.name : 'your deck'} folds to`;
    return {
      kind: 'field' as const, text: `${head}: ${ans}; ${hit}`,
      cardIds: uniq([...answers, ...theirs, ...myCore]), probability: null, provenance: 'heuristic' as const,
      reason: `Share of games from the synced meta (${info.periodLabel ?? info.source}, ${info.lists} lists); its plan is ${a.planId ? 'its tagged family' : 'detected on its most-played list'} (heuristic); answers and its tech are tech roles read from card text. No win-rate matrix is claimed.`,
    };
  });
}

function techLines(v: View, ctx: EngineContext): Line[] {
  if (!hasMeta(v.db)) return [];
  const share = new Map<TechRole, number>();
  const who = new Map<TechRole, MetaArchetype[]>();
  for (const a of v.db.meta().archetypes()) {
    const plan = archetypePlan(v.db, a);
    if (!plan) continue;
    for (const r of plan.foldsTo) {
      share.set(r, (share.get(r) ?? 0) + a.share);
      who.set(r, [...(who.get(r) ?? []), a]);
    }
  }
  const covered = new Set(v.cards.flatMap((c) => v.f(c.defId)?.techRoles ?? []));
  const roles = [...share].filter(([r, s]) => s > 0 && !covered.has(r)).sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])).slice(0, TECH_ROLES_SHOWN);
  if (!roles.length) return [];

  // What a tech card would replace: the deck's least connected card off the plans, never a locked one.
  const locked = new Set(v.deck.cards.filter((c) => c.locked).map((c) => c.defId));
  const core = new Set([...pieces(v.plans.primary), ...pieces(v.plans.secondary)]);
  const pool = v.cards.filter((c) => !locked.has(c.defId));
  const offPlan = pool.filter((c) => !core.has(c.defId));
  // Cards that are themselves tech go last: swapping one answer for another gains nothing.
  const isTech = (id: string): number => ((v.f(id)?.techRoles.length ?? 0) > 0 ? 1 : 0);
  const replaceable = (offPlan.length ? offPlan : pool)
    .map((c) => ({ id: c.defId, fit: fitInDeck(v, c.defId).fit + (v.f(c.defId)?.quality ?? 50) / 100 }))
    .sort((x, y) => isTech(x.id) - isTech(y.id) || x.fit - y.fit || x.id.localeCompare(y.id));
  if (!replaceable.length) return [];

  const out: Line[] = [];
  for (const [role, s] of roles) {
    const cands = v.db.released()
      .filter((c) => candidateOk(v, ctx, c) && !!v.db.features(c.defId)?.techRoles.includes(role))
      .map((c) => ({ c, ...fitInDeck(v, c.defId), q: v.db.features(c.defId)?.quality ?? 0 }))
      .sort((x, y) => y.fit - x.fit || y.q - x.q || x.c.defId.localeCompare(y.c.defId))
      .slice(0, TECH_CARDS_PER_ROLE);
    if (!cands.length) continue;
    const swaps = cands.map((x, i) => {
      const out = replaceable[Math.min(i, replaceable.length - 1)]!.id;
      return { id: x.c.defId, out, text: `${x.c.name}${x.partner ? ` (works with ${v.name(x.partner)})` : ''} for ${v.name(out)}` };
    });
    const targets = [...(who.get(role) ?? [])].sort((x, y) => y.share - x.share).slice(0, 3).map((a) => a.name);
    out.push({
      kind: 'tech',
      text: `${roleLabel(role)} would answer ${nameList(targets)} (${pct(s)} of games fold to it); your deck has none: ${swaps.map((x) => x.text).join(', or ')}`,
      cardIds: uniq(swaps.flatMap((x) => [x.id, x.out])), probability: null, provenance: 'heuristic',
      reason: 'Share of games whose detected plan folds to this tech role (synced meta; folds are plans.json heuristics). Cards ranked by edge scores into this deck, then quality; the replaced card is the least connected one off the plans.',
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Risks

function riskLines(v: View): Line[] {
  const out: Line[] = [];
  const { primary, secondary, all } = v.plans;
  if (!primary) {
    const best = all[0];
    out.push({
      kind: 'risk',
      text: best
        ? `No plan reaches ${pct(PLAN_THRESHOLD)} by its key turn: the closest is ${best.name} at ${pct(best.assembly)} with ${names(v, pieces(best))}`
        : `No plan of plans.json is in the deck: ${names(v, v.cards.slice(0, 4).map((c) => c.defId))}${v.cards.length > 4 ? ' and the rest' : ''} do not form an enabler and payoff package`,
      cardIds: best ? pieces(best) : v.cards.map((c) => c.defId),
      probability: best ? best.assembly : null, provenance: 'heuristic',
      reason: 'Plan detection with the 60% threshold of spec §10 (heuristic families).',
    });
  }
  // The deck's plans, or the closest one when none reaches the threshold.
  const planned = primary ? [primary, secondary] : [all[0] ?? null];
  for (const m of planned) {
    if (!m?.singleCardDependence) continue;
    const id = m.singleCardDependence;
    const { extra, deckSize } = drawAdjust(v.deck, v.db, m.keyTurn);
    const p = pAtLeastOne(1, m.keyTurn, extra, deckSize);
    out.push({
      kind: 'risk', text: `${m.name} rests on ${v.name(id)} alone: ${pct(p)} to have drawn it by turn ${m.keyTurn}, and an answer to it stops the plan`,
      cardIds: [id], probability: p, provenance: 'derived',
      reason: 'Only card of its side of the plan; exact odds of drawing one given card (theory §1.2).',
    });
  }
  for (const m of [primary, secondary]) {
    if (!m) continue;
    for (const fold of m.foldsTo) {
      if (fold.fieldShare === null || fold.fieldShare < FOLD_RISK_SHARE || !fold.cards.length) continue;
      const core = m.payoffs.length ? m.payoffs : m.enablers;
      out.push({
        kind: 'risk',
        text: `${m.name} folds to ${roleLabel(fold.role)}: ${nameList(fold.cards.slice(0, 3).map(v.name))} ${fold.cards.length > 1 ? 'and similar cards are' : 'is'} in ${pct(fold.fieldShare)} of meta lists, a threat to ${names(v, core)}`,
        cardIds: core, probability: fold.fieldShare, provenance: 'heuristic',
        reason: `Fold roles of the plan family (plans.json, heuristic); share of synced meta lists running a card with that tech role (measured). Threshold ${pct(FOLD_RISK_SHARE)} is heuristic.`,
      });
    }
  }
  const anti: CardEdge[] = [];
  for (let i = 0; i < v.cards.length; i++) {
    for (let j = i + 1; j < v.cards.length; j++) {
      const e = v.db.edge(v.cards[i]!.defId, v.cards[j]!.defId);
      if (e && e.score < 0) anti.push(e);
    }
  }
  for (const e of anti.sort((x, y) => x.score - y.score || x.a.localeCompare(y.a)).slice(0, MAX_ANTI_RISKS)) {
    const r = e.reasons.find((x) => x.kind === 'anti')!;
    out.push({
      kind: 'risk', text: `${v.name(e.a)} and ${v.name(e.b)} work against each other: ${r.label}`,
      cardIds: [e.a, e.b], probability: null, provenance: 'heuristic',
      reason: `Net negative edge of the interaction network (score ${e.score}); ${r.detail}`,
    });
  }
  return out;
}

/** Theorycraft lines of a deck (spec §15). */
export function generateLines(deck: Deck, ctx: EngineContext): LineReport {
  const v = viewOf(deck, ctx);
  if (!v.cards.length) return { turns: [], assembly: [], sequencing: [], locations: [], packages: [], oneAway: [], field: [], tech: [], risks: [] };
  return {
    turns: turnLines(v),
    assembly: assemblyLines(v),
    sequencing: sequencingLines(v),
    locations: locationLines(v),
    packages: packageLines(v),
    oneAway: oneAwayLines(v, ctx),
    field: fieldLines(v),
    tech: techLines(v, ctx),
    risks: riskLines(v),
  };
}
