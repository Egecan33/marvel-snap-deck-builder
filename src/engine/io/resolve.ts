import type { Card, CardDb } from '../types';

/**
 * Shared line reading for decklists and collection lists (plan Review focus 5). Pure string work.
 */

/** "# (cost) Name" as sites print it next to a code (data §4.4); "(?)" is what exportDecklist writes for an unknown card. */
export const LIST_LINE = /^#\s*\(\s*(?:\d+|\?)\s*\)\s*(.+?)\s*$/;

/** Curly quotes and odd spaces to plain ones, trimmed. */
export function tidy(line: string): string {
  return line.replace(/[‘’ʼ′`´]/g, "'").replace(/[“”″]/g, '"').replace(/[  -​  　﻿]/g, ' ').trim();
}

const PREFIXES = [
  /^[-*•·>]+\s*/,                 // bullets
  /^\(\s*\d+\s*\)\s*/,            // (cost)
  /^\d+\s*[x×]\s*/i,              // 1x
  /^[x×]\s*\d+\s+/i,              // x1
  /^\d+[.)]\s+/,                  // 7. or 7)
  /^\d+\s+/,                      // bare count
];
const SUFFIXES = [
  /\s*\(\s*\d+\s*\)$/,            // (cost)
  /\s+[x×]\s*\d+$/i,              // x1
  /\s*[x×]\s*\d+$/i,
];

function strip(text: string): string {
  let s = text;
  for (let changed = true; changed;) {
    changed = false;
    for (const re of [...PREFIXES, ...SUFFIXES]) {
      const next = s.replace(re, '').trim();
      if (next !== s && next !== '') {
        s = next;
        changed = true;
      }
    }
  }
  return s;
}

const firstColumn = (text: string): string => text.split(/[,;\t]/)[0].trim();

/**
 * Readings of one list line, most literal first: the line as written (names hold digits, commas
 * and dots: "Doctor Doom 2099", "Drax, Avatar Of Life"), then without counts, costs and bullets,
 * then the first CSV column of each.
 */
export function candidates(line: string): string[] {
  const s = tidy(line);
  const listed = LIST_LINE.exec(s)?.[1];
  const base = listed ?? s;
  const stripped = strip(base);
  return [...new Set([base, stripped, firstColumn(base), firstColumn(stripped)].filter((c) => c !== ''))];
}

/** A card by exact defId first, then by display name (case, accent and apostrophe-insensitive; released preferred). */
export function lookup(text: string, db: CardDb): Card | undefined {
  return db.get(text) ?? db.byName(text);
}

/** The first card any reading of `line` names, or undefined. */
export function resolveLine(line: string, db: CardDb): Card | undefined {
  for (const c of candidates(line)) {
    const hit = lookup(c, db);
    if (hit) return hit;
  }
  return undefined;
}

/** Why a card id from a code or list is not taken, in words that name it. */
export function rejectReason(id: string, db: CardDb, allowUpcoming: boolean): string | null {
  const c = db.get(id);
  if (!c) return `${id}: not in the card database`;
  if (c.cardClass === 'token') return `${c.name} (${id}): not a deck card (token, mode copy or created card)`;
  if (c.cardClass === 'upcoming' && !allowUpcoming) return `${c.name} (${id}): not released yet`;
  return null;
}
