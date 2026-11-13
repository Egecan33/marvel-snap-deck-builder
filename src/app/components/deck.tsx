'use client';

import { useState } from 'react';
import type { MetaInfo, NoveltyReport, PlanMatch } from '@/engine/types';
import type { Lookup } from '../lib/api';
import { BAND_RANGE, DECK_SIZE, bandLabel, fmtDate, fmtInt, nearestSummary, pct, sortByCost } from '../lib/ui';
import { BAND_COLOR, BandChip, CardArt, Prov } from './card';

const nameOf = (lookup: Lookup, id: string): string => lookup[id]?.name ?? id;
export const names = (lookup: Lookup, ids: readonly string[]): string => ids.map((id) => nameOf(lookup, id)).join(', ');

/** The 12 cards as art, sorted by cost, in two rows of six (the in-game deck layout). */
export function DeckArtGrid({ ids, lookup, onOpen, cols = 6, highlight }: {
  ids: readonly string[]; lookup: Lookup; onOpen?: (id: string) => void; cols?: number; highlight?: ReadonlySet<string>;
}) {
  const sorted = sortByCost(ids, lookup);
  const slots: (string | null)[] = [...sorted, ...Array(Math.max(0, DECK_SIZE - sorted.length)).fill(null)];
  return (
    <div className="grid gap-0" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }} data-testid="deck-art-grid">
      {slots.map((id, i) =>
        id && !onOpen ? (
          <div key={id} className={`-my-[6%] rounded-lg ${highlight?.has(id) ? 'bg-nov-offmeta/15' : ''}`} data-testid="deck-slot" data-id={id}>
            <CardArt id={id} card={lookup[id]} />
          </div>
        ) : id ? (
          <button
            key={id}
            type="button"
            className={`-my-[6%] block rounded-lg text-left ${onOpen ? 'cursor-zoom-in' : 'cursor-default'} ${highlight?.has(id) ? 'bg-nov-offmeta/15' : ''}`}
            onClick={() => onOpen?.(id)}
            aria-label={nameOf(lookup, id)}
            data-testid="deck-slot"
            data-id={id}
          >
            <CardArt id={id} card={lookup[id]} />
          </button>
        ) : (
          <div key={`empty-${i}`} className="card"><div className="card-missing border-dashed !bg-none opacity-40" /></div>
        ),
      )}
    </div>
  );
}

/** Corpus honesty (spec §13): source, date, list count and the tracker-bias caveat, on every novelty panel. */
export function CorpusNote({ corpus, withheld }: { corpus: MetaInfo | null; withheld: string | null }) {
  if (!corpus) {
    return <p className="text-[0.78rem] text-faint" data-testid="corpus-note">No meta lists are synced, so nothing is compared against the field. Run the meta sync on the Data page.</p>;
  }
  return (
    <p className="text-[0.78rem] leading-snug text-faint" data-testid="corpus-note">
      Compared with {fmtInt(corpus.lists)} lists ({fmtInt(corpus.clusters)} clusters of near-duplicates) from {corpus.source.startsWith('untapped') ? 'Untapped' : corpus.source}
      {corpus.periodLabel ? `, ${corpus.periodLabel}` : ''}, fetched {fmtDate(corpus.fetchedAt)}. These are lists of tracker users with {corpus.minGamesPerList}+ games each,
      which leans to high ranks: a card can be rare here and common elsewhere.
      {withheld && <span className="text-r-mid"> {withheld}</span>}
    </p>
  );
}

/** One-line plan summary: who enables, who pays off, assembly odds by the key turn. */
export function planLine(plan: PlanMatch | null, lookup: Lookup): string {
  if (!plan) return 'No plan detected at 60% assembly.';
  return `${plan.name}: ${names(lookup, plan.enablers.slice(0, 3))} feeding ${names(lookup, plan.payoffs.slice(0, 3))}; ${pct(plan.assembly)} assembled by turn ${plan.keyTurn}`;
}

/** The novelty evidence (spec §13): parts, nearest lists, rare-but-connected cards, unexplored pairs, corpus. */
export function NoveltyEvidence({ nov, lookup, onOpen }: { nov: NoveltyReport; lookup: Lookup; onOpen?: (id: string) => void }) {
  const [openList, setOpenList] = useState<string | null>(null);
  const parts = [
    { key: 'listDistance', label: 'Distance from the nearest lists', w: 0.45, v: nov.parts.listDistance },
    { key: 'connectedRarity', label: 'Rare cards that are connected', w: 0.25, v: nov.parts.connectedRarity },
    { key: 'packageNovelty', label: 'Unexplored strong pairs', w: 0.3, v: nov.parts.packageNovelty },
  ];
  return (
    <div className="space-y-4" data-testid="novelty-evidence">
      <div className="flex items-center gap-3">
        <span className="display text-[2.4rem] leading-none" style={{ color: BAND_COLOR[nov.band] }}>{nov.band === 'unknown' ? '–' : nov.novelty}</span>
        <div>
          <BandChip band={nov.band} />
          <p className="mt-0.5 text-[0.78rem] text-muted">{bandLabel(nov.band)} is {BAND_RANGE[nov.band]}. Novelty measures distance, not strength.</p>
        </div>
      </div>
      <p className="text-[0.95rem]" data-testid="nearest-summary">This deck {nearestSummary(nov)}.</p>

      <ul className="space-y-1 text-[0.82rem]">
        {parts.map((p) => (
          <li key={p.key} className="flex items-center gap-2">
            <Prov p="measured" />
            <span className="flex-1 text-muted">{p.label} <span className="text-faint">x {p.w}</span></span>
            <span className="h-1.5 w-24 overflow-hidden rounded bg-line"><span className="block h-full bg-nov-offmeta" style={{ width: `${Math.round(p.v * 100)}%` }} /></span>
            <span className="w-9 text-right">{Math.round(p.v * 100)}</span>
          </li>
        ))}
      </ul>

      {nov.nearest.length > 0 && (
        <section>
          <h4 className="text-[0.85rem] font-semibold">Nearest known lists</h4>
          <ul className="mt-1 space-y-1">
            {nov.nearest.map((n) => (
              <li key={n.key} className="text-[0.82rem]">
                <button type="button" className="text-left hover:text-nov-offmeta" onClick={() => setOpenList(openList === n.key ? null : n.key)} aria-expanded={openList === n.key} data-testid="nearest-list">
                  <b>{n.shared} of 12 shared</b> with {n.archetype ?? 'an unlabelled list'} <span className="text-faint">({fmtInt(n.games)} games)</span>
                  <span className="ml-1 text-faint">{openList === n.key ? 'hide' : 'show list'}</span>
                </button>
                {openList === n.key && (
                  <div className="mt-1 rounded-md border border-line p-1">
                    <DeckArtGrid ids={n.cards} lookup={lookup} onOpen={onOpen} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {nov.rareCards.length > 0 && (
        <section>
          <h4 className="text-[0.85rem] font-semibold">Rare cards in the deck</h4>
          <ul className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5 text-[0.82rem]">
            {nov.rareCards.map((r) => (
              <li key={r.defId} className="flex items-center gap-1.5">
                <Prov p="measured" />
                <span className="flex-1 truncate">{nameOf(lookup, r.defId)}</span>
                <span className="text-muted">{r.isNew ? 'new, rarity not meaningful' : `${pct(r.listShare)} of lists`}</span>
                {!r.connected && <span className="text-r-mid" title="No strong edge to another deck card">unconnected</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {nov.pairs.length > 0 && (
        <section>
          <h4 className="text-[0.85rem] font-semibold">Unexplored strong pairs</h4>
          <ul className="mt-1 space-y-0.5 text-[0.82rem]">
            {nov.pairs.slice(0, 6).map((p) => (
              <li key={`${p.a}|${p.b}`}>
                <b>{nameOf(lookup, p.a)} + {nameOf(lookup, p.b)}</b>
                <span className="text-muted"> seen together in {p.observed} clusters, {p.expected.toFixed(1)} expected from popularity</span>
                {p.warning && <span className="block text-r-mid">{p.warning}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <CorpusNote corpus={nov.corpus} withheld={nov.claimsWithheld} />
    </div>
  );
}
