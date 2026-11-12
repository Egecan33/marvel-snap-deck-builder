/**
 * Flat trait ids and the clause queries every features and network module shares (spec §8.2).
 *
 * A trait is a fact read off a card's parsed clauses (docs/research/mechanics.md §2): its triggers,
 * `<effect kind>_<zone>` pairs ("destroy_own", "cost_reduce_hand"), and the tags of its conditions,
 * scaling sources and selectors. Nothing here judges value; `axes.ts` and `network/` do that.
 */
import type { Card, Clause, Effect } from '../types';

export interface Hit { clause: Clause; effect: Effect }

/** Effects whose kind (and optionally target, clause trigger) match. Patterns are anchored by the caller. */
export function effs(clauses: readonly Clause[], kind: RegExp, target?: RegExp, trigger?: RegExp): Hit[] {
  const out: Hit[] = [];
  for (const clause of clauses) {
    if (trigger && !trigger.test(clause.trigger)) continue;
    for (const effect of clause.effects) {
      if (kind.test(effect.kind) && (!target || target.test(effect.target))) out.push({ clause, effect });
    }
  }
  return out;
}

export const hasTrigger = (clauses: readonly Clause[], rx: RegExp): boolean => clauses.some((c) => rx.test(c.trigger));

/**
 * Tags of a card: `cond:<name>` for conditions, `obj:<name>` for Objective requirements (already
 * prefixed by the parser), `scale:<name>` for scaling sources, and every effect selector (`sel:*`).
 */
export function tagsOf(clauses: readonly Clause[]): Set<string> {
  const tags = new Set<string>();
  for (const c of clauses) {
    for (const cond of c.conditions) tags.add(cond.startsWith('obj:') ? cond : `cond:${cond}`);
    for (const s of c.scaling) tags.add(`scale:${s}`);
    for (const e of c.effects) for (const s of e.selectors) tags.add(s);
  }
  return tags;
}

export const hasTag = (tags: ReadonlySet<string>, rx: RegExp): boolean => {
  for (const t of tags) if (rx.test(t)) return true;
  return false;
};

/** A clause's text matches (case-sensitive unless the pattern says otherwise). */
export const clauseText = (clauses: readonly Clause[], rx: RegExp): Clause | undefined => clauses.find((c) => rx.test(c.text));

/** Owner group of a target: which side an effect lands on. */
export function zoneOf(target: string): string {
  if (target === 'self') return 'self';
  if (target === 'own_hand') return 'hand';
  if (target === 'own_deck') return 'deck';
  if (target === 'own_player') return 'player';
  if (target === 'enemy_hand') return 'enemy_hand';
  if (target === 'enemy_deck') return 'enemy_deck';
  if (target === 'enemy_player') return 'enemy_player';
  if (target.startsWith('own')) return 'own';
  if (target.startsWith('enemy')) return 'enemy';
  if (target === 'location') return 'location';
  return 'all';
}

/** Flat trait ids of a card (spec §8.2): triggers, `<kind>_<zone>`, tags, and card-level flags. */
export function traitsOf(card: Pick<Card, 'hasAbility' | 'isSkill' | 'cost' | 'power'>, clauses: readonly Clause[]): string[] {
  const out = new Set<string>();
  if (!card.hasAbility && !card.isSkill) out.add('no_ability');
  if (card.isSkill) out.add('skill');
  for (const c of clauses) {
    out.add(c.trigger);
    for (const e of c.effects) out.add(`${e.kind}_${zoneOf(e.target)}`);
  }
  for (const t of tagsOf(clauses)) out.add(t);
  return [...out].sort();
}

// ------------------------------------------------------------------ text predicates read off card text

/**
 * Cost filter named in a sentence ("4-Cost", "1, 2, and 3-Cost", "6-Cost or more", "that cost 0").
 * Returns the predicate, its wording and the template strength (3 exact, 2 range) of mechanics §4.1.
 */
export function costPred(s: string): { test: (cost: number) => boolean; label: string; strength: number } | null {
  let m = /(\d), (\d),? and (\d)-Cost/.exec(s);
  if (m) {
    const v = new Set([m[1], m[2], m[3]].map(Number));
    return { test: (k) => v.has(k), label: `cost ${[...v].join(', ')}`, strength: 3 };
  }
  m = /(\d) (?:and|or) (\d)-Cost/.exec(s);
  if (m) {
    const v = new Set([m[1], m[2]].map(Number));
    return { test: (k) => v.has(k), label: `cost ${[...v].join(' or ')}`, strength: 3 };
  }
  m = /(\d)-Cost or (?:more|higher)|that are (\d)-Cost or more|that [Cc]ost (\d) or more/.exec(s);
  if (m) {
    const n = Number(m[1] ?? m[2] ?? m[3]);
    return { test: (k) => k >= n, label: `cost ${n} or more`, strength: 2 };
  }
  m = /(\d)-Cost or (?:less|lower)|[Cc]ost (\d) or less/.exec(s);
  if (m) {
    const n = Number(m[1] ?? m[2]);
    return { test: (k) => k <= n, label: `cost ${n} or less`, strength: 2 };
  }
  m = /(\d)-Cost|that cost (\d)\b/.exec(s);
  if (m) {
    const n = Number(m[1] ?? m[2]);
    return { test: (k) => k === n, label: `cost ${n}`, strength: 3 };
  }
  return null;
}

/** Power filter named in a sentence ("10 or more Power", "1 or less Power"). */
export function powerPred(s: string): { n: number; test: (power: number) => boolean; label: string; strength: number } | null {
  let m = /(\d+) or more Power/.exec(s);
  if (m) {
    const n = Number(m[1]);
    return { n, test: (p) => p >= n, label: `Power ${n} or more`, strength: 3 };
  }
  m = /(\d+) or less Power|(\d) Power or less/.exec(s);
  if (m) {
    const n = Number(m[1] ?? m[2]);
    return { n, test: (p) => p <= n, label: `Power ${n} or less`, strength: 2 };
  }
  return null;
}

/** The card moves itself (Moveable keyword, "move to another location", granted Moveable on itself). */
export const selfMover = (clauses: readonly Clause[]): boolean =>
  hasTrigger(clauses, /^moveable$/) || effs(clauses, /^move$/, /^self$/).length > 0 || effs(clauses, /^grant_moveable$/, /^self$/).length > 0;

/** The card moves or grants movement to cards other than itself. */
export const movesOthers = (clauses: readonly Clause[]): boolean =>
  effs(clauses, /^move$/, /^(own_(?!player)|any_played_card|moved_card)/).length > 0 || effs(clauses, /^grant_moveable$/, /^(own|all)/).length > 0;

/**
 * Cards whose own text hurts their owner: candidates for own-side text removal (Zero, Sauron, Enchantress).
 * HEURISTIC: a reading of effect shapes, checked against the 13 drawback cards of mechanics §3.
 */
export function isDrawback(clauses: readonly Clause[]): boolean {
  if (effs(clauses, /^afflict$/, /^(self|own_here)$/, /^ongoing$/).length) return true;           // Lizard, Typhoid Mary
  if (effs(clauses, /^buff$/, /^enemy/, /^ongoing$/).length) return true;                          // Red Skull
  if (effs(clauses, /^lockdown$/, /^own_player$/, /^ongoing$/).length) return true;               // Electro, Ebony Maw
  if (effs(clauses, /^loc_power$/, /^enemy$/, /^ongoing$/).length) return true;                   // Starbrand
  if (effs(clauses, /^destroy$/, /^own_other_locations$/, /^on_reveal$/).length && !clauseText(clauses, /for each|Add their Power/)) return true; // Destroyer, Tombstone
  if (effs(clauses, /^opp_draw$/).length) return true;                                            // Maximus
  if (effs(clauses, /^afflict$/, /^own_here$/, /^on_reveal$/).length) return true;                 // Yellowjacket
  if (effs(clauses, /^afflict$/, /^all_here$/, /^end_of_turn$/).length) return true;               // Hellcow Fractured Frontier
  if (effs(clauses, /^destroy$/, /^own_here$/, /^end_of_turn$/).length) return true;               // Attuma
  if (clauseText(clauses, /You lose \d Max Energy/)) return true;                                   // Havok
  return false;
}

/** Play restriction in words (the sentence that states it), or null. */
export function restrictionOf(clauses: readonly Clause[]): string | null {
  const c = clauses.find((cl) => cl.trigger === 'play_restriction') ?? clauses.find((cl) => cl.effects.some((e) => e.kind === 'play_restriction'));
  return c ? c.text.trim() : null;
}
