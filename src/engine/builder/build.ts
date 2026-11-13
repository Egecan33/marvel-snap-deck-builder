/**
 * Builder entry points (spec §14): `build` (brew and tuned), `fillRest`, `explainPicks`.
 *
 * build: candidate pool (pool.ts) -> greedy from the locks (or a sampled gem pair for "surprise me") ->
 * seeded annealing chains (search.ts) -> archive by primary plan x curve shape -> the exact check of
 * every returned deck: the power floor (floor.ts, C5 included for brew locks), and in brew mode novelty
 * of at least 60 and at most `maxShared` cards shared with any list. Up to `count` decks from different
 * archive cells, best first; or `refused` with the reason when nothing passes. Deterministic for a seed.
 *
 * Every pick carries interaction, why it is unusual, what it replaces and its risk (theory §4.7), with
 * measured / derived / heuristic labels in the text.
 */
import { mulberry32 } from '../maths/rng';
import { corpusOf, coplay } from '../novelty/clusters';
import { gemsFor } from '../novelty/gems';
import { deckIds, nearestLists, noveltyOf } from '../novelty/novelty';
import { isPartner } from '../network/edges';
import { detectPlans, lockedArchetypePlan } from '../plans/detect';
import { edgeLabel, nameOf, names } from '../rating/deck';
import { rateDeck } from '../rating/rate';
import type { BrewResult, BuildOptions, BuildOutcome, CardDb, Deck, EngineContext, FloorReport, PickReason } from '../types';
import { checkFloor, FLOOR, realPartners, unmetConditions } from './floor';
import { allowed, candidatePool, DEFAULT_PROMPTS } from './pool';
import { anneal, createSpace, greedy, offer, SEARCH, type Archive, type Candidate } from './search';

export { DEFAULT_PROMPTS } from './pool';

/** Most decks one build returns (spec §14: up to six). */
export const MAX_RESULTS = 6;
/** Exact checks (floor + novelty) one build may spend on archive candidates. */
const VERIFY_BUDGET = 36;
const SIZE = 12;

const pct = (x: number): string => `${x < 0.01 && x > 0 ? (x * 100).toFixed(1) : Math.round(x * 100)}%`;

function lockedIds(deck: Deck, db: CardDb): string[] {
  const out: string[] = [];
  for (const dc of Array.isArray(deck?.cards) ? deck.cards : []) {
    if (dc?.locked && typeof dc.defId === 'string' && !out.includes(dc.defId)) out.push(dc.defId);
  }
  void db;
  return out;
}

const deckFrom = (base: Deck, ids: readonly string[], locks: ReadonlySet<string>, mode: 'brew' | 'tuned', name: string): Deck => ({
  id: null,
  name,
  format: base?.format || 'ranked',
  cards: ids.map((defId) => ({ defId, locked: locks.has(defId) })),
  themes: Array.isArray(base?.themes) ? [...base.themes] : [],
  buildMode: mode,
});

interface Verified { ids: string[]; cand: Candidate; floor: FloorReport; noveltyOk: boolean; rating: number | null; failed: string[] }

/** Runs the search for one set of fixed cards. */
interface Searched { verified: Verified[]; failures: Map<string, number>; seenFeasible: number; closest: { ids: string[]; floor: FloorReport; novelty: number | null } | null }

function search(deck: Deck, ctx: EngineContext, opts: BuildOptions, fixed: string[], c5: string[], poolIds: string[], targetPlan: string | null = null): Searched {
  const db = ctx.db;
  const prompts = { ...DEFAULT_PROMPTS, ...(opts.prompts ?? {}) };
  const brew = opts.mode === 'brew';
  const space = createSpace(db, poolIds, { mode: opts.mode, fixed, c5, maxShared: brew ? prompts.maxShared : null, wildcards: brew ? Math.max(0, prompts.wildcards) : 0, targetPlan });
  const archive: Archive = { cells: new Map() };
  const fixedIdx = space.fixed;

  // Starts: greedy from the fixed cards; in tuned mode also the meta lists holding every fixed card.
  const starts: number[][] = [greedy(space, fixedIdx, SIZE)];
  if (!brew && db.meta().info()) {
    const lists = db.meta().lists();
    const holders = fixed.length ? fixed.map((id) => new Set(db.meta().listsWith(id))) : [];
    let taken = 0;
    for (let i = 0; i < lists.length && taken < 8; i++) {
      if (holders.length && !holders.every((h) => h.has(i))) continue;
      const idx = lists[i]!.cards.map((id) => space.index.get(id));
      if (idx.some((x) => x === undefined) || idx.length !== SIZE) continue;
      starts.push(idx as number[]);
      taken++;
    }
  }
  for (const s of starts.slice(1)) {
    const ev = space.evaluate(s);
    offer(archive, s, ev, space.objective(ev));
  }

  const chains = Math.max(2, Math.min(MAX_RESULTS, Math.max(1, Math.floor(opts.count || 1))) + 1);
  const occupied = new Set<string>();
  const chainBests: number[][] = [];
  let bestRun: { deck: number[]; violations: number; F: number } | null = null;
  const rootSeed = Number.isFinite(opts.seed) ? Math.floor(opts.seed) : 0;
  for (let c = 0; c < chains; c++) {
    const startDeck = !brew && c > 0 && starts.length > 1 ? starts[1 + ((c - 1) % (starts.length - 1))]! : starts[0]!;
    // Calibration pass: later chains also pay for sharing more than 12 - SEARCH.minDiff cards with an earlier chain's best deck.
    const best = anneal(space, startDeck, (rootSeed ^ (c * 0x9e3779b1)) >>> 0, Math.round(SEARCH.proposals * (c === 0 ? 1.4 : 1)), archive, occupied, chainBests);
    if (best.ev.violations <= 1e-9) {
      occupied.add(best.ev.cell);
      chainBests.push([...best.deck]);
    }
    const F = space.objective(best.ev);
    if (!bestRun || best.ev.violations < bestRun.violations - 1e-9 || (Math.abs(best.ev.violations - bestRun.violations) <= 1e-9 && F > bestRun.F)) bestRun = { deck: [...best.deck], violations: best.ev.violations, F };
  }

  // Exact check, cells by their best objective, candidates in each cell in objective order.
  const cells = [...archive.cells.entries()].sort((a, b) => b[1][0]!.F - a[1][0]!.F || (a[0] < b[0] ? -1 : 1));
  const verified: Verified[] = [];
  const failures = new Map<string, number>();
  let budget = VERIFY_BUDGET;
  let closest: Searched['closest'] = null;
  const want = Math.max(1, Math.min(MAX_RESULTS, Math.floor(opts.count || 1)));
  for (const [, list] of cells) {
    if (verified.length >= (brew ? want : Math.max(want, 3)) || budget <= 0) break;
    for (const cand of list) {
      // Calibration pass: a result must differ from every earlier result by at least SEARCH.minDiff cards.
      if (verified.some((v) => 12 - v.ids.filter((x) => cand.deck.some((i) => space.ids[i] === x)).length < SEARCH.minDiff)) continue;
      if (budget-- <= 0) break;
      const ids = cand.deck.map((i) => space.ids[i]!);
      const d = deckFrom(deck, ids, new Set(), opts.mode, '');
      const floor = checkFloor(d, ctx, c5);
      const failed = floor.checks.filter((c) => !c.passed).map((c) => c.key.split(':')[0]!);
      let noveltyOk = true;
      if (brew) {
        const nov = noveltyOf(d, ctx);
        const shared = nov.nearest[0]?.shared ?? 0;
        // With no meta lists novelty is unknown (band 'unknown'): the bar cannot be checked and is not claimed in `why`.
        if (nov.band !== 'unknown' && nov.novelty < SEARCH.minNovelty) { noveltyOk = false; failed.push('novelty'); }
        if (prompts.maxShared !== null && shared > prompts.maxShared) { noveltyOk = false; failed.push('maxShared'); }
      }
      for (const f of failed) failures.set(f, (failures.get(f) ?? 0) + 1);
      if (!closest) closest = { ids, floor, novelty: brew ? noveltyOf(d, ctx).novelty : null };
      if (floor.passed && noveltyOk) {
        verified.push({ ids, cand, floor, noveltyOk, rating: brew ? null : rateDeck(d, ctx).rating, failed });
        break;
      }
    }
  }
  const seenFeasible = [...archive.cells.values()].reduce((s, l) => s + l.length, 0);
  // Nothing reached the exact check: report the floor of the search's best deck instead (engine review: name the failing checks).
  if (!closest && bestRun) {
    const ids = bestRun.deck.map((i) => space.ids[i]!);
    const d = deckFrom(deck, ids, new Set(), opts.mode, '');
    closest = { ids, floor: checkFloor(d, ctx, c5), novelty: brew ? noveltyOf(d, ctx).novelty : null };
  }
  return { verified, failures, seenFeasible, closest };
}

/** Refusal text for a build-around card the prompts leave fewer than three real partners (strong, or 0.4+ text-backed). */
function partnerRefusal(db: CardDb, card: string, allowedIds: ReadonlySet<string>): string | null {
  const partners = realPartners(db, card, [...allowedIds]);
  if (partners.length >= FLOOR.buildAroundPartners!) return null;
  return `${nameOf(db, card)} has ${partners.length} partner${partners.length === 1 ? '' : 's'} among the cards the prompts allow${partners.length ? ` (${names(db, partners)})` : ''}; a build-around card needs at least ${FLOOR.buildAroundPartners} (theory §4.5 C5; a partner is a strong edge, or 0.4 or more with a text-derived reason). The interaction network is heuristic, so a real partner can be missing.`;
}

export function build(deck: Deck, ctx: EngineContext, opts: BuildOptions): BuildOutcome {
  const db = ctx.db;
  const prompts = { ...DEFAULT_PROMPTS, ...(opts?.prompts ?? {}) };
  const o: BuildOptions = { mode: opts?.mode === 'tuned' ? 'tuned' : 'brew', seed: Number.isFinite(opts?.seed) ? opts.seed : 0, owned: opts?.owned ?? ctx.owned, prompts, count: Math.max(1, Math.min(MAX_RESULTS, Math.floor(opts?.count || 1))) };
  const c: EngineContext = { db, owned: o.owned };
  const brew = o.mode === 'brew';
  const locks = lockedIds(deck, db);
  if (locks.length > SIZE) return { results: [], refused: `${locks.length} locked cards; a deck has ${SIZE}.` };
  for (const id of locks) {
    const card = db.get(id);
    const empty: Deck = { ...deck, cards: [] };
    const why = card ? allowed(db, id, empty, { ...o, prompts: { ...prompts, maxPlayRate: null, maxSeries: null, avoid: [] } }, c) : 'unknown';
    if (why) return { results: [], refused: `${card ? card.name : id} cannot be in the deck (${why}${card ? '' : ': not in the card database'}).` };
  }

  // Cards the prompts allow, for the C5 pre-check.
  const allowedIds = new Set(db.released().map((x) => x.defId).filter((id) => locks.includes(id) || !allowed(db, id, deck, o, c)));
  const c5 = brew ? locks : [];
  for (const id of c5) {
    const r = partnerRefusal(db, id, allowedIds);
    if (r) return { results: [], refused: r };
  }

  // Fixed cards: the locks, or a sampled gem pair for "surprise me" when nothing is locked.
  const tries: string[][] = [];
  if (prompts.surprise && locks.length === 0) {
    const rnd = mulberry32((Math.floor(o.seed) ^ 0x5eed) >>> 0);
    const gems = gemsFor(db, 400).filter((g) => g.cards.length === 2 && g.cards.every((x) => allowedIds.has(x)));
    const pick = gems.slice(0, 30);
    for (let t = 0; t < 3 && pick.length; t++) {
      const g = pick.splice(Math.floor(rnd() * pick.length), 1)[0]!;
      tries.push([...g.cards]);
    }
    if (tries.length === 0) tries.push([]);
  } else {
    tries.push(locks);
  }

  // Tuned around an archetype's core (calibration pass): keep that archetype's plan; fall back to a free search when nothing passes.
  const target = brew ? null : lockedArchetypePlan(db, locks);
  let kept: typeof target = null;
  let last: ReturnType<typeof search> | null = null;
  let lastFixed: string[] = locks;
  for (const fixed of tries) {
    const pool = candidatePool(fixed, deck, o, c);
    let res = target ? search(deck, c, o, fixed, c5, pool.ids, target.planId) : null;
    if (res && res.verified.length) kept = target;
    else res = search(deck, c, o, fixed, c5, pool.ids);
    last = res;
    lastFixed = fixed;
    if (res.verified.length) break;
  }
  const res = last!;
  if (res.verified.length === 0) {
    const top = [...res.failures].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => `${k} (${n})`);
    const around = lastFixed.length ? ` around ${names(db, lastFixed)}` : '';
    const head = res.seenFeasible === 0
      ? `No deck${around} met the floor constraints inside the search${brew ? ` together with novelty ${SEARCH.minNovelty}+ and at most ${prompts.maxShared ?? 12} cards shared with a known list` : ''}.`
      : `No deck${around} passed the exact floor check${brew ? ' and novelty bar' : ''}; failed most often: ${top.join(', ')}.`;
    return { results: [], refused: `${head}${closestText(db, res.closest)}` };
  }

  const lockSet = new Set(locks);
  const ranked = brew ? res.verified : [...res.verified].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0) || b.cand.F - a.cand.F);
  const results: BrewResult[] = ranked.slice(0, o.count).map((v) => {
    const plans = detectPlans(deckFrom(deck, v.ids, lockSet, o.mode, ''), c);
    const plan = plans.primary;
    const title = locks.length ? `${names(db, locks.slice(0, 2))}${locks.length > 2 ? ' and more' : ''}` : lastFixed.length ? names(db, lastFixed) : (plan?.name ?? 'Brew');
    const ids = [...v.ids].sort((a, b) => (db.get(a)!.cost - db.get(b)!.cost) || (db.get(a)!.name < db.get(b)!.name ? -1 : 1));
    const d = deckFrom(deck, ids, lockSet, o.mode, `${title}: ${plan ? plan.name : 'network package'}`);
    const rating = rateDeck(d, c).rating;
    const novelty = noveltyOf(d, c);
    let why = whyText(db, d, plan, v, rating, novelty, locks, lastFixed, brew);
    if (kept) why += ` Kept in ${plan?.name ?? kept.planId}, the plan of the ${kept.archetype} core you locked.`;
    else if (target) why += ` No deck in the plan of the ${target.archetype} core passed the floor, so the search was free to change plan.`;
    return { deck: d, rating, novelty, floor: v.floor, plan, why, picks: explainPicks(d, c) };
  });
  return { results, refused: null };
}

/** The failed checks of the closest deck the search found, with values, thresholds and the cards each names. */
function closestText(db: CardDb, closest: Searched['closest']): string {
  if (!closest) return '';
  const fails = closest.floor.checks.filter((c) => !c.passed);
  const nov = closest.novelty !== null && closest.novelty < SEARCH.minNovelty ? [`novelty ${closest.novelty} (at least ${SEARCH.minNovelty})`] : [];
  if (!fails.length && !nov.length) return '';
  const r = (x: number): string => (Number.isInteger(x) ? String(x) : x.toFixed(2));
  const parts = fails.map((c) => `${c.key} ${r(c.value)} against ${r(c.threshold)}: ${c.detail}`);
  return ` Closest deck (${names(db, closest.ids)}) fails ${[...parts, ...nov].join(' | ')}`;
}

function whyText(db: CardDb, d: Deck, plan: BrewResult['plan'], v: Verified, rating: number, nov: BrewResult['novelty'], locks: string[], fixed: string[], brew: boolean): string {
  const near = nov.nearest[0];
  const parts: string[] = [];
  if (locks.length) parts.push(`Built around ${names(db, locks)}.`);
  else if (fixed.length) parts.push(`Surprise: started from the pair ${names(db, fixed)}.`);
  if (plan) parts.push(`Plan: ${plan.name}, ${names(db, plan.enablers)} feeding ${names(db, plan.payoffs)}, ${pct(plan.assembly)} assembly by turn ${plan.keyTurn} (exact odds over heuristic families).`);
  const coh = v.cand.ev;
  parts.push(`${coh.strong} strong pairs and ${coh.linked} linked pairs of 66; cohesion ${coh.coh.toFixed(1)}, ${coh.cohMech.toFixed(1)} of it from the interaction network (heuristic)${coh.coh - coh.cohMech > 0.05 ? ` and ${(coh.coh - coh.cohMech).toFixed(1)} from co-play in the meta corpus (measured)` : ''}; floor passed (${v.floor.checks.length} checks).`);
  if (nov.band === 'unknown') parts.push('Novelty not claimed.');
  else parts.push(`Novelty ${nov.novelty} (${nov.band})${near ? `: shares at most ${near.shared} of 12 cards with a known list${near.archetype ? ` (${near.archetype})` : ''}` : ''}.`);
  if (nov.claimsWithheld) parts.push(nov.claimsWithheld);
  // HEURISTIC, tuned against meta lists and random piles but not calibrated against win rates (HANDOVER "After the calibration pass").
  parts.push(brew
    ? `Rating ${rating} of 100 is a heuristic construction check, not calibrated against win rates; a brew's pairs are unproven (little co-play in the meta corpus), so they earn at most half the synergy credit and the deck rates below a proven list built as well.`
    : `Rating ${rating} of 100 is a heuristic construction check, not calibrated against win rates.`);
  if (!brew) parts.push('Tuned mode: ranked by the deck rating.');
  void d;
  return parts.join(' ');
}

/**
 * Fills the deck to 12 keeping every card already in it (they count as locks for the search). Runs the
 * builder with count 1; when nothing passes the floor it still fills greedily (best objective) so the
 * person gets 12 cards, and the floor shows what is missing.
 */
export function fillRest(deck: Deck, ctx: EngineContext, opts: BuildOptions): Deck {
  const db = ctx.db;
  const keep = deckIds(deck, db).slice(0, SIZE);
  if (keep.length >= SIZE) return { ...deck, cards: keep.map((defId) => ({ defId, locked: (deck.cards.find((x) => x.defId === defId)?.locked) ?? false })) };
  const lockedBefore = new Set(lockedIds(deck, db));
  const asLocked: Deck = { ...deck, cards: keep.map((defId) => ({ defId, locked: true })) };
  const o: BuildOptions = { ...opts, prompts: { ...DEFAULT_PROMPTS, ...(opts?.prompts ?? {}), surprise: false }, count: 1 };
  // The C5 rule and novelty bar are for build-around brews; filling an existing deck uses tuned rules.
  const out = build(asLocked, ctx, { ...o, mode: 'tuned' });
  let ids: string[];
  if (out.results.length) {
    ids = out.results[0]!.deck.cards.map((x) => x.defId);
  } else {
    const pool = candidatePool(keep, deck, { ...o, mode: 'tuned' }, ctx);
    const space = createSpace(db, pool.ids, { mode: 'tuned', fixed: keep, c5: [], maxShared: null, wildcards: 0 });
    const filled = greedy(space, space.fixed, SIZE);
    const best = anneal(space, filled, (Math.floor(opts?.seed ?? 0) >>> 0), SEARCH.proposals, { cells: new Map() });
    ids = best.deck.map((i) => space.ids[i]!);
  }
  const order = [...keep, ...ids.filter((id) => !keep.includes(id))];
  return { ...deck, cards: order.map((defId) => ({ defId, locked: lockedBefore.has(defId) })) };
}

/**
 * Explanations of the non-locked cards of a deck (theory §4.7): interaction (best partner, preferring a
 * locked card; both texts quoted by the edge), why it is unusual (play rate, pair co-play, nearest list),
 * what it replaces (the same-cost card of the nearest list, with the assembly change) and risk (plan
 * folds, single-card dependence, anti-synergy, data confidence). Labels name each number's provenance.
 */
export function explainPicks(deck: Deck, ctx: EngineContext): PickReason[] {
  const db = ctx.db;
  const ids = deckIds(deck, db);
  const locked = new Set(lockedIds(deck, db));
  const corpus = corpusOf(db);
  const { o1, nearest } = nearestLists(db, ids, 1);
  const near = nearest[0];
  const plans = detectPlans(deck, ctx);
  const baseAsm = plans.primary?.assembly ?? 0;
  const out: PickReason[] = [];
  for (const id of ids) {
    if (locked.has(id)) continue;
    const c = db.get(id)!;
    // Interaction.
    const edges = db.edges(id)
      .filter((e) => e.a !== e.b && ids.includes(e.a === id ? e.b : e.a) && e.score > 0)
      .sort((x, y) => {
        // A real partner of a locked card is named first (calibration pass: strong, or 0.4+ text-backed).
        const lx = locked.has(x.a === id ? x.b : x.a) && isPartner(x) ? 1 : 0;
        const ly = locked.has(y.a === id ? y.b : y.a) && isPartner(y) ? 1 : 0;
        return ly - lx || y.score - x.score || (x.a + x.b < y.a + y.b ? -1 : 1);
      });
    const best = edges[0];
    let interaction: string;
    let partner: string | null = null;
    if (best && best.score >= FLOOR.linkedEdge!) {
      partner = best.a === id ? best.b : best.a;
      const r = best.reasons.filter((x) => x.kind === 'synergy').sort((x, y) => y.value - x.value)[0];
      const others = edges.slice(1, 3).filter((e) => e.score >= FLOOR.linkedEdge!).map((e) => nameOf(db, e.a === id ? e.b : e.a));
      interaction = `${c.name} + ${nameOf(db, partner)}: ${edgeLabel(best)}${best.strong ? ', strong' : isPartner(best) ? ', partner' : ''} (pair score ${best.score.toFixed(2)}, heuristic). ${r?.detail ?? ''}${others.length ? ` Also works with ${others.join(' and ')}.` : ''}`.trim();
    } else {
      interaction = `${c.name} has no pair of ${FLOOR.linkedEdge} or more in this deck: it fills the ${c.cost}-Cost slot of the curve (${c.cost}/${c.power}).`;
    }
    // Unusual.
    const share = corpus.listShare(id);
    let unusual: string;
    if (!corpus.info) {
      unusual = `No meta snapshot is synced, so ${c.name}'s play rate and the deck's distance from known lists are unknown.`;
    } else {
      const pair = partner ? coplay(corpus, [id, partner]) : null;
      unusual = `${c.name} is in ${pct(share)} of ${corpus.lists} tracked lists (measured)`
        + (pair ? `; with ${nameOf(db, partner!)} in ${pair.observed} of ${corpus.clusters} list clusters, where popularity alone predicts ${pair.expected.toFixed(1)} (measured)` : '')
        + `; the deck shares at most ${o1} of 12 cards with ${near?.archetype ? `a ${near.archetype} list` : 'any known list'} (measured).`
        + (corpus.withheld ? ` ${corpus.withheld}` : '');
    }
    // Replaces.
    let replaces: string;
    if (near) {
      const slot = near.cards.filter((x) => !ids.includes(x) && db.get(x)).sort((a, b) => Math.abs(db.get(a)!.cost - c.cost) - Math.abs(db.get(b)!.cost - c.cost) || (a < b ? -1 : 1))[0];
      if (slot) {
        const swapped = detectPlans({ ...deck, cards: ids.map((x) => ({ defId: x === id ? slot : x, locked: false })) }, ctx).primary?.assembly ?? 0;
        const sc = db.get(slot)!;
        replaces = `Takes the slot ${sc.name} (${sc.cost}-Cost) holds in the nearest known list${near.archetype ? ` (${near.archetype})` : ''}; with ${sc.name} instead the primary plan assembles in ${pct(swapped)} against ${pct(baseAsm)} now (derived odds over heuristic families), cost ${sc.cost} vs ${c.cost}.`;
      } else {
        replaces = `The nearest known list has no card outside this deck to compare ${c.name} with.`;
      }
    } else {
      replaces = `No known list to compare with: ${c.name} is ${c.cost}-Cost, ${c.power} Power.`;
    }
    // Risk.
    const risks: string[] = [];
    const inPlan = [plans.primary, plans.secondary].find((p) => p && (p.enablers.includes(id) || p.payoffs.includes(id)));
    if (inPlan) {
      const fold = [...inPlan.foldsTo].sort((a, b) => (b.fieldShare ?? 0) - (a.fieldShare ?? 0))[0];
      if (fold && fold.cards.length) risks.push(`${inPlan.name} folds to ${fold.role}: ${names(db, fold.cards.slice(0, 3))}${fold.fieldShare !== null ? `, in ${pct(fold.fieldShare)} of tracked lists (measured)` : ''}.`);
      if (inPlan.singleCardDependence === id) risks.push(`${inPlan.name} rests on ${c.name} alone (${pct(inPlan.assembly)} by turn ${inPlan.keyTurn}, derived).`);
      else risks.push(`${inPlan.name} assembles in ${pct(inPlan.assembly)} by turn ${inPlan.keyTurn} (derived).`);
    } else {
      risks.push(`${c.name} is in no detected plan (heuristic families), so it is a flex or tech slot.`);
    }
    const antiE = db.edges(id).filter((e) => e.anti > 0 && e.a !== e.b && ids.includes(e.a === id ? e.b : e.a)).sort((x, y) => y.anti - x.anti)[0];
    if (antiE) risks.push(`Works against ${nameOf(db, antiE.a === id ? antiE.b : antiE.a)} (${edgeLabel(antiE, 'anti')}, heuristic).`);
    for (const u of unmetConditions(db, id, ids)) risks.push(`Unmet condition (heuristic): ${u}`);
    if (corpus.withheld) risks.push('Pair statistics rest on a thin corpus: "unexplored" is not claimed.');
    out.push({ defId: id, interaction, unusual, replaces, risk: risks.join(' ') });
  }
  return out;
}
