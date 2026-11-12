import type { CardDb } from '../types';
import { decodeDeckCode, DECK_CODE_TOKEN } from './deckcode';
import { LIST_LINE, rejectReason, resolveLine, tidy } from './resolve';

/**
 * Collection import box (data §5.4, spec §16): one input, the format is detected.
 *
 *   state-file: CollectionState.json from a Windows install; owned = distinct ServerState.Cards[].CardDefId
 *               (shape taken from community script source, data §5.3: not verified on a real file)
 *   deck-codes: one or more pasted deck codes; their cards count as owned
 *   list:       one card per line, by defId or display name, "# (cost) Name", "1x Name" or CSV
 *
 * Only released cards are owned. Tokens, mode copies, unreleased and unknown ids are reported.
 */

function stateFile(text: string, db: CardDb): { owned: string[]; unresolved: string[]; kind: 'state-file' } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return { owned: [], unresolved: [`The file is not valid JSON (${e instanceof Error ? e.message : 'parse error'}).`], kind: 'state-file' };
  }
  const list = (data as { ServerState?: { Cards?: unknown } } | null)?.ServerState?.Cards;
  if (!Array.isArray(list)) {
    return { owned: [], unresolved: ['The JSON has no ServerState.Cards list, so it is not a game collection file this importer knows.'], kind: 'state-file' };
  }
  const owned: string[] = [];
  const unresolved: string[] = [];
  const seen = new Set<string>();
  for (const entry of list) {
    const id = entry && typeof entry === 'object' ? (entry as { CardDefId?: unknown }).CardDefId : undefined;
    if (typeof id !== 'string' || id === '' || seen.has(id)) continue; // not a card entry, or another copy/variant of one
    seen.add(id);
    const why = rejectReason(id, db, false);
    if (why) unresolved.push(why);
    else owned.push(id);
  }
  return { owned, unresolved, kind: 'state-file' };
}

export function parseCollection(input: string, db: CardDb): { owned: string[]; unresolved: string[]; kind: 'state-file' | 'deck-codes' | 'list' } {
  if (typeof input !== 'string') return { owned: [], unresolved: [], kind: 'list' };
  const text = input.replace(/^﻿/, '').trim();
  if (text.startsWith('{') || text.startsWith('[')) return stateFile(text, db);

  const owned: string[] = [];
  const unresolved: string[] = [];
  const have = new Set<string>();
  const take = (id: string): void => {
    if (!have.has(id)) {
      have.add(id);
      owned.push(id);
    }
  };
  let codes = 0;
  for (const raw of text.split(/\r?\n|\r/)) {
    const l = tidy(raw);
    if (l === '' || (l.startsWith('#') && !LIST_LINE.test(l))) continue;
    const decoded = DECK_CODE_TOKEN.test(l) ? decodeDeckCode(l, db) : null;
    if (decoded) {
      codes++;
      for (const id of decoded.cards) {
        const why = rejectReason(id, db, false);
        if (why) unresolved.push(`${why} (from deck code ${codes})`);
        else take(id);
      }
      continue;
    }
    const hit = resolveLine(l, db);
    if (hit && hit.cardClass === 'released') take(hit.defId);
    else unresolved.push(l);
  }
  return { owned, unresolved, kind: codes > 0 ? 'deck-codes' : 'list' };
}
