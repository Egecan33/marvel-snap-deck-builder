/**
 * Card-text parser (spec §8.1): a TypeScript port of docs/research/analysis/mechanics/parse_cards.py,
 * run on the synced Untapped text.
 *
 *   text -> keyword segments ("On Reveal: ...") -> sentences -> Clause { trigger, effects, conditions, scaling }
 *
 * The phrase tables live in `vocab.ts`. What changed from the prototype is target attachment: the
 * prototype looked for owner words anywhere in a window around an effect and mis-attached the target
 * on about 15% of cards (mechanics §2.1). Here each effect reads one noun phrase, chosen by the shape
 * of its wording:
 *   - "Destroy X", "Move X to ...", "Remove the text from X": the object after the verb
 *   - "Give X +2 Power", "X have +2 Power", "X cost 1 less": the phrase in front of the magnitude
 *   - "+2 Power to X": the "to" phrase after it
 *   - "X moves", "X switch sides", "X can't be destroyed": the subject in front of the verb
 *   - pronouns ("it", "them", "the copy") take the place where the previous effect's card ended up
 *     (a copy added to your hand is in your hand), else the card named by the trigger
 * A bare "+N Power" with no recipient is this card. `complete` is the prototype's token-level claim
 * (every word consumed by some phrase); the target audit (tests/fixtures/clause-audit.json) is the
 * check that the attachment is right.
 */
import type { Card, Clause, Effect } from '../types';
import {
  CONDITIONS, DURATIONS, EFFECT_RULES, HEADERS, HEADER_SOURCE, OBJECTIVE_REQ, PASSIVE, SCALING, SELECTORS, STATIC_TRIGGERS,
  SETUP, STOP, TARGET_WORDS, type EffectKind, type Target, type Trigger,
} from './vocab';

export { EFFECT_KINDS, TARGETS, TRIGGERS } from './vocab';

export interface ParsedCard { clauses: Clause[]; unparsed: string[] }

const HEADER_MAP = new Map<string, readonly Trigger[]>(HEADERS.map(([h, t]) => [h, t]));
const PRONOUN = 'that_card';

/** Card named by an event trigger: what "it" means when no earlier effect gave it a meaning. */
const TRIGGER_SUBJECT: Record<string, Target> = {
  on_opp_play: 'enemy_played_card', on_own_play: 'own_played_card', on_any_play: 'any_played_card',
  on_other_move: 'moved_card', on_draw_any: 'own_drawn_card', on_self_move: 'self', on_self_merge: 'self',
  on_self_empowered: 'self', on_self_bounce: 'self', when_destroyed: 'self', when_discarded: 'self', on_draw_self: 'self',
  on_any_empowered: 'own_anywhere',
};
/** Effects on players or counters: they never become the antecedent of "it". */
const NO_ANTECEDENT = new Set<EffectKind>(['energy_gain', 'energy_max', 'energy_deny', 'horde', 'info', 'draw', 'opp_draw', 'expiry', 'special', 'deny_on_reveal', 'loc_change', 'total_power', 'lockdown']);

interface Span { a: number; b: number; kind: EffectKind; fixed: Target | null; core: string }
interface State { last: { target: string; landed: string; clause: number } | null; clause: number }

// ---------------------------------------------------------------- noun phrases

const EDGE = new Set(['give', 'gives', 'gain', 'gains', 'get', 'gets', 'have', 'has', 'with', 'and', 'or', 'to', 'then', 'also',
  'otherwise', 'reveals', 'reveal', 'an', 'additional', 'instead', 'but', 'is', 'are', 'from', 'of', 'on', 'in', 'into', 'too']);

/** Lower case, punctuation removed, function words trimmed from both ends. */
function norm(phrase: string): string {
  const words = phrase.toLowerCase().replace(/[.,;:!"]/g, ' ').split(/\s+/).filter(Boolean);
  while (words.length && EDGE.has(words[0]!)) words.shift();
  while (words.length && EDGE.has(words[words.length - 1]!)) words.pop();
  return words.join(' ');
}

/** The target a noun phrase names, `that_card` for a pronoun, or null when it names nothing. */
export function classifyPhrase(raw: string): string | null {
  const p = norm(raw);
  if (!p) return null;
  if (/\bnext (card|character) you play\b/.test(p)) return 'own_next_played';
  if (/^(this|itself|this card|this one)\b(?! location)/.test(p) && !/\b(cards|characters)\b/.test(p)) return 'self';
  // "created in your hand" says where the cards came from, not where they are.
  const q = p.replace(/\byour opponent('s)?\b/g, 'opponent').replace(/\blosing player('s)?\b/g, 'player').replace(/that were created in your hand/g, 'created');
  if (/\b(each player('s)?|both players|all hands|both decks|each deck('s)?|either side|both sides|each side|players|nobody)\b/.test(q)) {
    // Both players' hands or decks; cards in play on both sides are "all".
    if (!/\bhands?\b|\bdecks?\b|deck's/.test(q) && /\b(cards?|characters?)\b/.test(q)) return /\bhere\b/.test(q) ? 'all_here' : 'all_anywhere';
    return 'both';
  }
  const owner = /\benem(y|ies)\b|\bopponent\b|\btheirs\b/.test(q) ? 'enemy' : /\b(your|yours|you)\b/.test(q) ? 'own' : null;
  if (!owner && /^(it|its|them|they|those|that|their|the copy|that card|those cards|one)\b/.test(q)) return PRONOUN;
  const hand = /\bhands?\b/.test(q);
  const deck = /\bdecks?\b|deck's/.test(q);
  const here = /\bhere\b|\bthere\b|this location/.test(q);
  const other = /\bother locations?\b|\banother location\b|\badjacent\b/.test(q);
  if (owner === 'enemy') return hand ? 'enemy_hand' : deck ? 'enemy_deck' : here ? 'enemy_here' : 'enemy_anywhere';
  if (owner === 'own') return hand ? 'own_hand' : deck ? 'own_deck' : here ? 'own_here' : other ? 'own_other_locations' : 'own_anywhere';
  if (/\b(cards?|characters?)\b/.test(q)) return hand ? 'both' : deck ? 'both' : here ? 'all_here' : 'all_anywhere';
  return null;
}

const VERB = /^\s*(set|reset|invert|double|afflict|randomly split|split|destroy|discard|moves?|remove|steal|cop(y|ies)|merge|transform|resurrect|revive|regenerate|returns?|repeat|bring back|put|add|pull|recruit|get|use|shuffle|swap|replace|banish|follow|draws?|jump|has|have|give|immediately activate)\b/i;
/** Object of a verb: what follows it, up to a destination ("to", "into", "with") or the end of the sub-clause. */
function objectOf(text: string): string {
  const t = text.replace(VERB, ' ');
  return t.split(/(?<!\bup)\s(?:to|into|onto|with|but|then)\s|[,.;]|\s-?>\s/i)[0] ?? '';
}
/** The sub-clause in front of an effect, from the last comma or full stop. */
function lastPart(text: string): string {
  // A comma inside "1, 2, and 3-Cost" does not end a sub-clause; "to get" and "then" do.
  if (/\bto\s*$/i.test(text)) return ''; // "Discard a card to gain its Power": the infinitive has no subject of its own
  const parts = text.split(/[.;]|(?<!\d),|\bthen\b|\bto (?:get|gain)\b/i);
  return parts[parts.length - 1] ?? '';
}

// ---------------------------------------------------------------- targets

const COST_SIDE: Record<string, string> = { own_anywhere: 'own', enemy_anywhere: 'enemy', all_anywhere: 'both' };

/** Targets of one effect span (two when the recipient is "this and X"). Pronouns are returned as `that_card`. */
function targetsOf(sp: Span, i: number, spans: readonly Span[], masked: string, start: number, sentence: string): string[] {
  const { kind } = sp;
  const core = sp.core;
  const lc = core.toLowerCase();
  const prevEnd = i > 0 ? spans[i - 1]!.b : start;
  const gap = masked.slice(prevEnd, sp.a);
  const before = lastPart(gap);
  const after = masked.slice(sp.b, i + 1 < spans.length ? spans[i + 1]!.a : masked.length);
  const coreObject = objectOf(core);
  const object = classifyPhrase(coreObject) ?? classifyPhrase(objectOf(core.replace(VERB, '') + ' ' + after));
  const subject = classifyPhrase(before);
  const inheritFromPrevious = i > 0 && /^[\s,]*(and|or|with|too)?[\s,]*$/i.test(gap);
  const lowSentence = sentence.toLowerCase();

  // "+2 Power to X", "the recipients: this and X"
  const pair = (phrase: string): string[] | null => {
    const m = /^\s*(this|itself)\s+and\s+(.+)$/i.exec(norm(phrase));
    return m ? ['self', classifyPhrase(m[2]!) ?? 'self'] : null;
  };
  const trailing = (): string[] => {
    const toPhrase = /^\s*(to|on)\s+(.+)$/i.exec(after.split(/[,.;]/)[0] ?? '');
    if (toPhrase) return pair(toPhrase[2]!) ?? [classifyPhrase(toPhrase[2]!) ?? 'self'];
    const p = pair(before);
    if (p) return p;
    if (subject) return [subject];
    if (inheritFromPrevious) return ['inherit'];
    if (/\bif it('s)?\b/i.test(sentence)) return [PRONOUN]; // "If it's 5-Cost or more, -1 Cost too."
    return ['self'];
  };

  if (sp.fixed) return [sp.fixed];
  switch (kind) {
    case 'buff': case 'cost_increase':
      return trailing().map((t) => (kind === 'cost_increase' ? COST_SIDE[t] ?? t : t));
    case 'cost_reduce': {
      if (/^\s*set\b/i.test(core)) return [classifyPhrase(core.replace(/^\s*set\s+/i, '')) ?? 'inherit'];
      if (/^\s*it costs\b/i.test(core)) return [PRONOUN];
      return trailing().map((t) => COST_SIDE[t] ?? t);
    }
    case 'afflict':
      if (/^\s*(afflict|randomly split|split)\b/i.test(core)) {
        const inner = core.replace(/^\s*(afflict|randomly split|split)\s*/i, '').replace(/\s*with\b.*$/i, '').replace(/^-?\d+ Power among\s*/i, '');
        return [classifyPhrase(inner) ?? classifyPhrase(objectOf(after)) ?? 'self'];
      }
      return trailing();
    case 'power_double':
      if (/^double\s+(this card's|its|your)/i.test(core)) return [classifyPhrase(core.replace(/^double\s+/i, '')) ?? 'self'];
      if (/^Double (Power increases|Cost reductions) to this/i.test(core)) return ['self'];
      if (/^Double the Power reductions on/i.test(core)) return [classifyPhrase(after) ?? 'enemy_anywhere'];
      return trailing();
    case 'power_set':
      if (/^\s*(set|reset|invert)\b/i.test(core)) {
        if (/this card's power/i.test(core)) return ['self'];
        const inner = core.replace(/^\s*(set|reset|invert)\s+(the\s+)?(power\s+of\s+)?/i, '').replace(/\s*(to|equal)\b.*$/i, '');
        return [classifyPhrase(inner) ?? classifyPhrase(objectOf(after)) ?? 'self'];
      }
      return trailing();
    case 'power_absorb':
      if (/^Add this card's Power to/i.test(core)) return [classifyPhrase(objectOf(after)) ?? PRONOUN];
      if (subject) return [subject]; // "Give the next card you play Power equal to this card's Power"
      if (/^with\b/i.test(core) && i > 0) return ['inherit']; // "add X to your hand with that card's Power"
      return ['self'];
    case 'power_steal':
      return [classifyPhrase(core.replace(/^.*?\bfrom\b/i, '') + ' ' + objectOf(after)) ?? classifyPhrase(objectOf(after)) ?? PRONOUN];
    case 'energy_gain': case 'energy_max':
      return [/opponent|\bthey\b/i.test(before + core) ? 'enemy_player' : 'own_player'];
    case 'draw':
      if (/opponent's deck/i.test(after)) return ['enemy_deck'];
      return [/each player/i.test(gap + core) ? 'both' : 'own_player'];
    case 'discard': {
      const t = /^discards\b/i.test(core) && subject ? subject : object ?? subject ?? 'own_hand';
      // Discarding is from a hand: "Discard another When Discarded card" is from yours.
      return [t === 'own_anywhere' || t === 'all_anywhere' ? 'own_hand' : t === 'enemy_anywhere' ? 'enemy_hand' : t];
    }
    case 'move': {
      if (/^moves?\b/i.test(core) && /^moves\b/i.test(core) && subject) return [subject];
      if (/^pull\b/i.test(core)) return [classifyPhrase(objectOf(core.replace(/^pull\s+/i, '').replace(/\s+from here.*$/i, ' here'))) ?? 'enemy_here'];
      if (/^follow it/i.test(core)) return ['self'];
      const obj = classifyPhrase(objectOf(core.replace(/^\s*moves?\s*(away)?/i, '') + ' ' + after));
      return [obj ?? (subject && /^moves\b/i.test(core) ? subject : 'self')];
    }
    case 'switch_sides': case 'grant_moveable': case 'protect': case 'reveal_delay': {
      if (kind === 'protect' && /^nothing can stop/i.test(core)) return [/\bthis\b/i.test(core) ? 'self' : 'own_player'];
      if (kind === 'reveal_delay' && /\bit\b/i.test(core)) return [PRONOUN];
      if (kind === 'grant_moveable' && /^gets?\b/i.test(core) && inheritFromPrevious) return ['inherit'];
      if (kind === 'grant_moveable' && /^(is|are|gains?|it's|and) moveable/i.test(core)) {
        const s = classifyPhrase(before + (/^it's/i.test(core) ? ' it' : ''));
        return [s ?? 'self'];
      }
      return [subject ?? 'self'];
    }
    case 'lockdown': {
      if (/^you can/i.test(core)) return ['own_player'];
      if (/enemy cards here/i.test(before)) return ['enemy_here'];
      return ['both'];
    }
    case 'cost_other':
      return [COST_SIDE[subject ?? object ?? 'own_anywhere'] ?? subject ?? object ?? 'own'];
    case 'loc_power':
      return [/opponent/i.test(core + before) ? 'enemy' : 'own_other_locations'];
    case 'resurrect':
      if (/\b(this|itself)\b(?! location)|its next phase/i.test(core + ' ' + objectOf(after))) return ['self'];
      return [/opponent/i.test(lowSentence) ? 'enemy' : 'own'];
    case 'bounce':
      if (/\b(this|itself)\b/i.test(core)) return ['self'];
      return [classifyPhrase(core.replace(/^\s*returns?\s*/i, '').replace(/\s*to your hand.*$/i, '')) ?? 'self'];
    case 'merge': {
      const rest = (core + ' ' + objectOf(after)).replace(/\b(merges?|into|from merging)\b/gi, ' ').replace(/\bthis\b/gi, ' ');
      return [classifyPhrase(rest) ?? 'self'];
    }
    case 'summon':
      if (/jump|runs from|flies out|add this to/i.test(core)) return ['self'];
      return ['own'];
    case 'copy_card':
      if (/(in|into|to) your hand|your hand|opening hand/i.test(masked.slice(sp.a).split(/[.;]/)[0] ?? '')) return ['own_hand'];
      return ['own'];
    case 'gen_board':
      if (/each side/i.test(core + after)) return ['both'];
      return [/opponent|their side/i.test(core + after) ? 'enemy' : 'own'];
    case 'repeat_on_reveal':
      if (/its ability happens again/i.test(core)) return [PRONOUN];
      if (/Rama-Tut|Judge the worthy|repeat (this|its On Reveal) ability/i.test(core)) return ['self'];
      if (/uses that card's/i.test(core)) return ['own_anywhere'];
      return [classifyPhrase(core.replace(/^\s*(repeat|use)\s+/i, '') + ' ' + objectOf(after)) ?? 'own_here'];
    case 'repeat_ongoing':
      if (/random/i.test(core)) return ['self'];
      return [classifyPhrase(core + ' ' + objectOf(after)) ?? 'own_here'];
    case 'repeat_eot': case 'repeat_activate':
      return [classifyPhrase(core + ' ' + objectOf(after)) ?? 'own_here'];
    case 'transform':
      if (/^transform into/i.test(core) || /^become a copy/i.test(core)) return ['self'];
      return [classifyPhrase(objectOf(core.replace(/^\s*(transform(s)?|unlock (the|their) potential( of)?)\s*/i, '') + ' ' + after)) ?? (/their potential/i.test(core) ? PRONOUN : 'self')];
    default: {
      // destroy, silence, steal_text, copy_text, banish, control and other object verbs
      if (/\b(its|it)\b/i.test(core.replace(VERB, '')) && !/\bfrom\b/i.test(core)) return [PRONOUN];
      return [object ?? subject ?? 'self'];
    }
  }
}

/** Where the card an effect touched ends up, for a later "it". */
function landing(kind: EffectKind, target: string, core: string, sentence: string): string {
  switch (kind) {
    case 'bounce': return target === 'self' ? 'self' : target.startsWith('enemy') ? 'enemy_hand' : 'own_hand';
    case 'copy_card': return target === 'own' ? (/here/i.test(sentence) ? 'own_here' : 'own_anywhere') : target;
    case 'summon': case 'gen_board': case 'resurrect':
      if (target === 'self') return 'self';
      if (/to (your )?hand/i.test(sentence)) return target === 'enemy' ? 'enemy_hand' : 'own_hand';
      if (target === 'enemy') return /here|this location/i.test(sentence) ? 'enemy_here' : 'enemy_anywhere';
      return /here|this location|replace this|to replace it/i.test(sentence) ? 'own_here' : 'own_anywhere';
    case 'junk_board': return 'enemy_here';
    case 'move':
      if (/to (this location|here)|moves here/i.test(core + sentence)) return target;
      return target.endsWith('_here') ? target.replace('_here', '_anywhere') : target;
    default: return target;
  }
}

// ---------------------------------------------------------------- sentences

function magnitudeOf(kind: EffectKind, core: string): number | null {
  if (['silence', 'copy_text', 'repeat_on_reveal', 'summon', 'copy_card', 'protect', 'lockdown', 'play_restriction'].includes(kind)) return null;
  const m = ['gen_board', 'loc_power', 'afflict', 'buff'].includes(kind) ? /([+-]?\d+)[- ]Power/.exec(core) : /[+-]?\d+/.exec(core);
  if (!m) return null;
  const n = Number(m[1] ?? m[0]);
  if (!Number.isFinite(n)) return null;
  if (kind === 'afflict' || kind === 'cost_reduce') return Math.abs(n);
  return n;
}

function selectorsOf(text: string): string[] {
  const out = new Set<string>();
  for (const [rx, tag] of SELECTORS) if (new RegExp(rx.source, 'i').test(text)) out.add(tag);
  if (/\bother\b/i.test(text)) out.add('sel:other');
  return [...out].sort();
}

function moveDestination(text: string): string | null {
  const m = /\bmoves here|\bto (this location|here|the (right|left|middle)( location)?|another location|a random location|random locations|that card|there|any location)|one location to the (left|right)|at another location|to a location[^.]*/i.exec(text);
  return m ? m[0] : null;
}

function parseSentence(sentence: string, trigger: string, state: State, notes: string[]): Clause {
  const s = sentence;
  const consumed = new Array<boolean>(s.length).fill(false);
  const claim = (a: number, b: number): void => { for (let i = a; i < b; i++) consumed[i] = true; };
  const free = (a: number, b: number): boolean => { for (let i = a; i < b; i++) if (consumed[i]) return false; return true; };
  const mask = s.split('');
  const blank = (a: number, b: number): void => { for (let i = a; i < b; i++) mask[i] = ' '; };
  const conditions: string[] = [];
  const scaling: string[] = [];
  const clauseNotes = [...notes];

  let start = 0;
  let triggerPhrase = '';
  for (const [rx, trig] of PASSIVE) {
    const m = rx.exec(s);
    if (!m) continue;
    triggerPhrase = m[0];
    if (!STATIC_TRIGGERS.includes(trig)) {
      claim(m.index, m.index + m[0].length);
      blank(m.index, m.index + m[0].length);
      start = m.index + m[0].length;
    }
    break;
  }
  for (const [rx, name] of CONDITIONS) {
    for (const m of s.matchAll(rx)) {
      const a = m.index ?? 0, b = a + m[0].length;
      if (b > a && free(a, b)) { claim(a, b); blank(a, b); conditions.push(name); }
    }
  }
  for (const [rx, name] of SCALING) {
    for (const m of s.matchAll(rx)) {
      const a = m.index ?? 0, b = a + m[0].length;
      if (b > a && free(a, b)) { claim(a, b); if (name !== 'each') blank(a, b); scaling.push(name); }
    }
  }
  const masked = mask.join('');
  const spans: Span[] = [];
  for (const r of EFFECT_RULES) {
    for (const m of masked.matchAll(r.rx)) {
      const a = m.index ?? 0, b = a + m[0].length;
      if (b > a && free(a, b)) { claim(a, b); spans.push({ a, b, kind: r.kind, fixed: r.fixed, core: m[0] }); }
    }
  }
  spans.sort((x, y) => x.a - y.a);

  const effects: Effect[] = [];
  let prevTarget: string | null = null;
  spans.forEach((sp, i) => {
    const targets = targetsOf(sp, i, spans, masked, start, s);
    for (let t of targets) {
      if (t === 'inherit') t = prevTarget ?? 'self';
      if (t === PRONOUN) {
        // An event or self trigger names its own card; an antecedent from another sentence does not reach it.
        const useLast = state.last && !(trigger in TRIGGER_SUBJECT && state.last.clause !== state.clause);
        // "If you can't [move it], destroy it": the card did not go anywhere.
        if (useLast) t = conditions.includes('fallback') ? state.last!.target : state.last!.landed;
        else if (/after you play your next (card|character)|next (card|character) you play/i.test(s) || conditions.includes('play_here_next')) t = 'own_next_played';
        else if (trigger === 'on_other_move') t = /enemy/i.test(triggerPhrase) ? 'enemy_moved_card' : /your/i.test(triggerPhrase) ? 'own_moved_card' : 'moved_card';
        else t = TRIGGER_SUBJECT[trigger] ?? (conditions.includes('last_played_has_keyword') ? 'own_anywhere' : 'self');
      }
      const phrase = s.slice(sp.a, i + 1 < spans.length ? spans[i + 1]!.a : s.length);
      effects.push({ kind: sp.kind, target: t, magnitude: magnitudeOf(sp.kind, sp.core), selectors: selectorsOf(phrase) });
      const landed = landing(sp.kind, t, sp.core, s);
      prevTarget = landed;
      if (!NO_ANTECEDENT.has(sp.kind)) state.last = { target: t, landed, clause: state.clause };
    }
    if (sp.kind === 'cost_reduce' && /Cost and Power/i.test(sp.core)) {
      effects.push({ kind: 'power_set', target: prevTarget ?? 'self', magnitude: magnitudeOf('power_set', sp.core), selectors: [] });
    }
    if (sp.kind === 'move') {
      const dest = moveDestination(s.slice(sp.b));
      if (dest) clauseNotes.push(`move to: ${dest.trim()}`);
    }
  });

  let setup = false;
  for (const rx of SETUP) for (const m of s.matchAll(rx)) { const a = m.index ?? 0, b = a + m[0].length; if (b > a && free(a, b)) { claim(a, b); setup = true; } }
  for (const [rx] of SELECTORS) for (const m of s.matchAll(rx)) { const a = m.index ?? 0, b = a + m[0].length; if (b > a && free(a, b)) claim(a, b); }
  for (const [rx] of DURATIONS) for (const m of s.matchAll(rx)) { const a = m.index ?? 0, b = a + m[0].length; if (b > a && free(a, b)) claim(a, b); }
  for (const rx of TARGET_WORDS) for (const m of s.matchAll(rx)) { const a = m.index ?? 0, b = a + m[0].length; if (b > a && free(a, b)) claim(a, b); }
  const rest = s.split('').map((ch, i) => (consumed[i] ? ' ' : ch)).join('');
  const residual = (rest.match(/[A-Za-z0-9'/+\-!]+/g) ?? []).filter((w) => !STOP.has(w.toLowerCase()));
  // A sentence with no effect is read only when it is a known set-up sentence (vocab SETUP) or a standing property.
  const complete = (effects.length > 0 || setup || STATIC_TRIGGERS.includes(trigger)) && residual.length === 0
    && !conditions.includes('other') && !scaling.includes('other');
  return { trigger, effects, conditions, scaling, notes: clauseNotes, text: s, source: 'parser', complete };
}

// ---------------------------------------------------------------- cards

function splitSentences(text: string): string[] {
  return text.trim().split(/(?<=[.!])\s+(?=[A-Z+\-"])/).map((p) => p.trim()).filter(Boolean);
}

/** [triggers, body] per keyword header; text before the first header has no trigger yet. */
function segments(text: string): [readonly string[], string][] {
  const out: [readonly string[], string][] = [];
  let pos = 0;
  let cur: readonly string[] = ['static'];
  for (const m of text.matchAll(new RegExp(HEADER_SOURCE, 'g'))) {
    const at = m.index ?? 0;
    if ((text.slice(0, at).match(/"/g) ?? []).length % 2 === 1) continue; // a header quoted inside another ability
    const body = text.slice(pos, at).trim();
    if (body) out.push([cur, body]);
    cur = HEADER_MAP.get(m[1]!) ?? ['static'];
    pos = at + m[0].length;
  }
  const body = text.slice(pos).trim();
  if (body) out.push([cur, body]);
  return out;
}

/** Parse one card's text into clauses. Sentences not fully understood are listed in `unparsed`. */
export function parseCard(card: Pick<Card, 'text'>): ParsedCard {
  const text = card.text ?? '';
  if (!text.trim()) return { clauses: [], unparsed: [] };
  // "(if yours)" and "(enemies)" name the recipients of the magnitude in front of them.
  let body = text.replace(/\s*\(if yours\)/gi, ' to yours').replace(/\s*\(enemies\)/gi, ' to enemies');
  const notes = [...body.matchAll(/\(([^)]*)\)/g)].map((m) => m[1]!.trim()).filter((n) => n && n !== 's');
  body = body.replace(/\s*\((?!s\))[^)]*\)/g, '').replace(/\(s\)/g, 's').replace(/\s+([.,])/g, '$1');

  const clauses: Clause[] = [];
  const state: State = { last: null, clause: 0 };
  for (const [trigs, seg] of segments(body)) {
    if (trigs.length === 1 && trigs[0] === 'objective') {
      const [req = '', reward = ''] = seg.split(/\s*->\s*/, 2);
      const tag = OBJECTIVE_REQ.find(([rx]) => rx.test(req))?.[1] ?? null;
      const c = reward.trim()
        ? parseSentence(reward.trim(), 'objective', state, [...notes, `objective: ${req.trim()}`])
        : { trigger: 'objective', effects: [], conditions: [], scaling: [], notes: [`objective: ${req.trim()}`], text: '', source: 'parser' as const, complete: false };
      c.conditions.push(tag ?? 'obj:other');
      if (!tag) c.complete = false;
      c.text = seg;
      clauses.push(c);
      state.clause++;
      continue;
    }
    let prev: readonly string[] | null = null;
    for (const sentence of splitSentences(seg)) {
      let trig: readonly string[] | null = null;
      for (const [rx, t, override] of PASSIVE) {
        if (rx.test(sentence)) {
          if ((trigs.length === 1 && trigs[0] === 'static') || override) trig = [t];
          break;
        }
      }
      trig ??= trigs.length === 1 && trigs[0] === 'static' ? prev ?? ['static'] : trigs;
      prev = trig;
      for (const t of trig) {
        clauses.push(parseSentence(sentence, t, state, notes));
        state.clause++;
      }
    }
  }
  const unparsed = [...new Set(clauses.filter((c) => !c.complete).map((c) => c.text))];
  return { clauses, unparsed };
}
