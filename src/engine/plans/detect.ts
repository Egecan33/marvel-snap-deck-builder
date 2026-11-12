/**
 * Win conditions (spec §10; docs/research/deck-theory-and-creativity.md §2). HEURISTIC throughout:
 * the families, their trait patterns, thresholds and payoff weights are judgement written down in
 * sync-data/plans.json; the assembly probability on top of them is exact draw maths (theory §1.2).
 *
 * A plan's `enablerTraits` / `payoffTraits` are patterns over a card's features. One pattern is one or
 * more atoms joined by `&` (all must hold). Atoms:
 *  - a trait id exactly as `traitsOf` emits it (`horde_own`, `destroy_own`, `scale:distinct_costs`);
 *  - `axis:<axis id>.e` / `axis:<axis id>.p`: the enabler / payoff side of an axis read from the
 *    card's text (strength 1; a cost or Power guess of 0.5 does not count);
 *  - `role:<tech role>`: the card has that tech role;
 *  - `cost:<lo>-<hi>` / `power:<lo>-<hi>`: printed cost or Power in range;
 *  - `creates:no_ability`: the card creates a token whose text is empty (Rock), read from `Card.tokens`.
 * The research's trait names (theory §2) were placeholders; plans.json uses these real ids instead.
 */
import { pAtLeastOne, pOneOfEach } from '../maths/hypergeo';
import type { Card, CardDb, CardFeatures, Deck, EngineContext, PlanDef, PlanMatch, PlanReport, TechRole } from '../types';

/** Assembly probability by the key turn that a plan needs to count as a deck's plan (spec §10: 60%). */
export const PLAN_THRESHOLD = 0.6;
/** Most tech cards listed per fold role (the field share uses all of them). */
const FOLD_CARDS = 6;

type Atom = (card: Card, f: CardFeatures | undefined, db: CardDb) => boolean;

function range(spec: string): [number, number] | null {
  const m = /^(-?\d+)-(-?\d+)$/.exec(spec);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

/** Compiles one atom; returns null for an atom the grammar does not know (reported by `checkPlans`). */
export function compileAtom(atom: string): Atom | null {
  if (atom.startsWith('axis:')) {
    const m = /^axis:([a-z_]+)\.([ep])$/.exec(atom);
    if (!m) return null;
    const [, id, side] = m as unknown as [string, string, 'e' | 'p'];
    return (_c, f) => (f?.axes[id]?.[side] ?? 0) >= 1;
  }
  if (atom.startsWith('role:')) {
    const role = atom.slice(5);
    return (_c, f) => f?.techRoles.includes(role) ?? false;
  }
  if (atom.startsWith('cost:') || atom.startsWith('power:')) {
    const r = range(atom.slice(atom.indexOf(':') + 1));
    if (!r) return null;
    const key = atom.startsWith('cost:') ? 'cost' : 'power';
    return (c) => !c.isSkill && c[key] >= r[0] && c[key] <= r[1];
  }
  if (atom === 'creates:no_ability') {
    return (c, _f, db) => c.tokens.some((t) => {
      const tok = db.get(t);
      return !!tok && !tok.hasAbility && !tok.isSkill;
    });
  }
  if (!/^[a-z0-9_:]+$/.test(atom)) return null;
  return (_c, f) => f?.traits.includes(atom) ?? false;
}

/** Atoms of all patterns of a plan. */
export const atomsOf = (plan: PlanDef): string[] => [...plan.enablerTraits, ...plan.payoffTraits].flatMap((p) => p.split('&').map((a) => a.trim()));

const compiled = new Map<string, Atom[] | null>();
function compilePattern(pattern: string): Atom[] | null {
  if (!compiled.has(pattern)) {
    const atoms = pattern.split('&').map((a) => compileAtom(a.trim()));
    compiled.set(pattern, atoms.some((a) => !a) ? null : (atoms as Atom[]));
  }
  return compiled.get(pattern)!;
}

/** Does the card match any of the patterns? Unknown patterns never match. */
export function matchesAny(card: Card, f: CardFeatures | undefined, db: CardDb, patterns: readonly string[]): boolean {
  return patterns.some((p) => {
    const atoms = compilePattern(p);
    return !!atoms && atoms.every((a) => a(card, f, db));
  });
}

/**
 * Extra cards seen and deck size for a plan's assembly probability (spec §9, theory §1.2).
 * HEURISTIC: half of the extra draws (`model.extraSeen`) of the deck's cards that cost less than the
 * key turn, rounded down, at most 3, since a draw card helps only when it is itself drawn and played
 * in time. Deck size is 12 (or the card count of an oversized deck); shuffled-in cards are not counted.
 */
export function drawAdjust(deck: Deck, db: CardDb, keyTurn: number): { extra: number; deckSize: number } {
  let draws = 0;
  const ids = uniqueKnown(deck, db);
  for (const c of ids) {
    if (c.cost >= keyTurn) continue;
    draws += Math.max(0, db.features(c.defId)?.model.extraSeen ?? 0);
  }
  return { extra: Math.min(3, Math.floor(draws / 2)), deckSize: Math.max(12, ids.length) };
}

function uniqueKnown(deck: Deck, db: CardDb): Card[] {
  const seen = new Set<string>();
  const out: Card[] = [];
  for (const dc of deck.cards) {
    if (seen.has(dc.defId)) continue;
    seen.add(dc.defId);
    const c = db.get(dc.defId);
    if (c) out.push(c);
  }
  return out;
}

/** "A", "A and B", "A, B and C". */
export function nameList(names: readonly string[]): string {
  if (names.length === 0) return 'no card';
  if (names.length === 1) return names[0]!;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

interface FoldInfo { cards: string[]; fieldShare: number | null }
const foldCache = new WeakMap<CardDb, Map<TechRole, FoldInfo>>();

/**
 * Released cards with a tech role (most played first) and the share of meta lists running at least
 * one of them (measured, from synced lists); `fieldShare` is null without a meta snapshot.
 */
export function foldInfo(db: CardDb, role: TechRole): FoldInfo {
  let perDb = foldCache.get(db);
  if (!perDb) foldCache.set(db, (perDb = new Map()));
  const hit = perDb.get(role);
  if (hit) return hit;
  const meta = db.meta();
  const lists = meta.info() ? meta.lists().length : 0;
  const holders = db.released().filter((c) => db.features(c.defId)?.techRoles.includes(role));
  const share = (id: string): number => meta.cardStat(id)?.listShare ?? 0;
  const cards = holders.map((c) => c.defId).sort((a, b) => share(b) - share(a) || a.localeCompare(b));
  let fieldShare: number | null = null;
  if (lists > 0) {
    const covered = new Set<number>();
    for (const id of cards) for (const i of meta.listsWith(id)) covered.add(i);
    fieldShare = covered.size / lists;
  }
  const info = { cards: cards.slice(0, FOLD_CARDS), fieldShare };
  perDb.set(role, info);
  return info;
}

/** One plan against a deck, or null when the deck lacks the plan's minimum enablers or payoffs. */
export function matchPlan(plan: PlanDef, deck: Deck, db: CardDb): PlanMatch | null {
  const cards = uniqueKnown(deck, db);
  const enablers: Card[] = [];
  const payoffs: Card[] = [];
  const dual: Card[] = [];
  for (const c of cards) {
    const f = db.features(c.defId);
    const e = matchesAny(c, f, db, plan.enablerTraits);
    const p = matchesAny(c, f, db, plan.payoffTraits);
    if (e && p) dual.push(c);
    else if (e) enablers.push(c);
    else if (p) payoffs.push(c);
  }
  // A card that is both counts once: as a payoff, unless enablers are short and payoffs to spare.
  for (const c of dual) {
    if (plan.minEnablers > 0 && enablers.length < plan.minEnablers && payoffs.length >= Math.max(1, plan.minPayoffs)) enablers.push(c);
    else payoffs.push(c);
  }
  if (enablers.length < plan.minEnablers || payoffs.length < plan.minPayoffs) return null;
  if (enablers.length + payoffs.length === 0) return null;

  const { extra, deckSize } = drawAdjust(deck, db, plan.keyTurn);
  const assembly = plan.minEnablers === 0 && enablers.length === 0
    ? pAtLeastOne(payoffs.length, plan.keyTurn, extra, deckSize)
    : plan.minPayoffs === 0 && payoffs.length === 0
      ? pAtLeastOne(enablers.length, plan.keyTurn, extra, deckSize)
      : pOneOfEach(enablers.length, payoffs.length, plan.keyTurn, extra, deckSize);

  let singleCardDependence: string | null = null;
  if (payoffs.length === 1 && plan.minPayoffs > 0) singleCardDependence = payoffs[0]!.defId;
  else if (enablers.length === 1 && plan.minEnablers > 0) singleCardDependence = enablers[0]!.defId;
  else if (plan.minEnablers === 0 && enablers.length === 0 && payoffs.length === 1) singleCardDependence = payoffs[0]!.defId;

  const takesLocations = plan.takesLocations
    .replaceAll('{enablers}', nameList(enablers.map((c) => c.name)))
    .replaceAll('{payoffs}', nameList(payoffs.map((c) => c.name)));
  return {
    planId: plan.id,
    name: plan.name,
    strength: Math.min(1, Math.max(0, assembly * plan.payoffWeight)),
    enablers: enablers.map((c) => c.defId),
    payoffs: payoffs.map((c) => c.defId),
    assembly,
    keyTurn: plan.keyTurn,
    singleCardDependence,
    takesLocations,
    foldsTo: plan.foldsTo.map((role) => ({ role, ...foldInfo(db, role) })),
  };
}

/**
 * Plans of a deck (spec §10). `all` holds every family whose minimum enablers and payoffs are in the
 * deck, strongest first; the primary plan is the strongest (assembly x payoff weight) whose assembly by
 * its key turn reaches PLAN_THRESHOLD, the secondary the next one that does. `offPlan` lists the deck's
 * cards that are in neither. Never throws: unknown cards are ignored, an empty deck has no plan.
 */
export function detectPlans(deck: Deck, ctx: EngineContext): PlanReport {
  const db = ctx.db;
  const all: PlanMatch[] = [];
  for (const plan of db.plans()) {
    const m = matchPlan(plan, deck, db);
    if (m) all.push(m);
  }
  all.sort((x, y) => y.strength - x.strength || y.assembly - x.assembly || x.planId.localeCompare(y.planId));
  const qualified = all.filter((m) => m.assembly >= PLAN_THRESHOLD);
  const primary = qualified[0] ?? null;
  const secondary = qualified[1] ?? null;
  const onPlan = new Set<string>();
  for (const m of [primary, secondary]) if (m) for (const id of [...m.enablers, ...m.payoffs]) onPlan.add(id);
  const offPlan = uniqueKnown(deck, db).map((c) => c.defId).filter((id) => !onPlan.has(id));
  return { primary, secondary, all, offPlan };
}

/** Problems in plan definitions: unknown atoms, unknown tech roles, bad numbers. Empty when sound. */
export function checkPlans(plans: readonly PlanDef[], knownRoles: readonly TechRole[]): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const p of plans) {
    if (ids.has(p.id)) problems.push(`${p.id}: duplicate id`);
    ids.add(p.id);
    for (const a of atomsOf(p)) if (!compileAtom(a)) problems.push(`${p.id}: unknown atom "${a}"`);
    for (const r of p.foldsTo) if (!knownRoles.includes(r)) problems.push(`${p.id}: unknown tech role "${r}"`);
    if (!(p.keyTurn >= 1 && p.keyTurn <= 7)) problems.push(`${p.id}: key turn ${p.keyTurn}`);
    if (!(p.payoffWeight > 0 && p.payoffWeight <= 1)) problems.push(`${p.id}: payoff weight ${p.payoffWeight}`);
    if (p.minEnablers < 0 || p.minPayoffs < 0 || p.minEnablers + p.minPayoffs === 0) problems.push(`${p.id}: minimums ${p.minEnablers}/${p.minPayoffs}`);
  }
  return problems;
}
