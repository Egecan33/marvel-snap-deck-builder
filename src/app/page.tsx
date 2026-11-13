'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { BandChip, RATING_COLOR } from './components/card';
import { DeckArtGrid } from './components/deck';
import { ImportDialog } from './components/ImportDialog';
import { useNotify, useStatus } from './components/Shell';
import { deleteDeck, getCard, listDecks, type DeckTile, type Lookup } from './lib/api';
import { fmtDate, isAbort, ratingBand } from './lib/ui';

/** Saved decks as tiles: their 12 cards, rating, novelty band and legality (spec §16). */
export default function DecksPage() {
  const notify = useNotify();
  const { status } = useStatus();
  const [decks, setDecks] = useState<DeckTile[] | null>(null);
  const [lookup, setLookup] = useState<Lookup>({});
  const [importing, setImporting] = useState(false);

  const load = useCallback((signal?: AbortSignal) => {
    listDecks(signal).then(
      (r) => setDecks(r.decks),
      (e) => !isAbort(e) && notify.error(e),
    );
  }, [notify]);
  useEffect(() => {
    const ctrl = new AbortController();
    load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  // Tiles carry only ids: fetch the card rows once for cost, Power and names.
  useEffect(() => {
    if (!decks) return;
    const ids = [...new Set(decks.flatMap((d) => d.cards))].filter((id) => !lookup[id]);
    if (!ids.length) return;
    Promise.all(ids.map((id) => getCard(id, null).then((d) => d.card, () => null))).then((cards) =>
      setLookup((l) => ({ ...l, ...Object.fromEntries(cards.filter((c) => c !== null).map((c) => [c.defId, c])) })),
    );
  }, [decks, lookup]);

  const remove = async (d: DeckTile) => {
    if (!window.confirm(`Delete "${d.name}"? This cannot be undone.`)) return;
    try {
      await deleteDeck(d.id);
      setDecks((ds) => ds?.filter((x) => x.id !== d.id) ?? null);
      notify.info(`Deleted ${d.name}`);
    } catch (e) {
      notify.error(e);
    }
  };

  return (
    <div className="mx-auto max-w-[1500px] p-6">
      <div className="flex items-end gap-4">
        <div>
          <h1 className="display text-[2.2rem] leading-none">Your decks</h1>
          {status && <p className="mt-1 text-[0.85rem] text-muted">{decks ? `${decks.length} saved` : 'Loading'}. Ratings are heuristic; novelty is measured against the synced meta lists.</p>}
        </div>
        <span className="flex-1" />
        <button type="button" className="btn" onClick={() => setImporting(true)} data-testid="decks-import">Import</button>
        <Link href="/new" className="btn btn-primary" data-testid="decks-brew">Brew a deck</Link>
      </div>

      {decks && decks.length === 0 && (
        <div className="mt-10 max-w-[60ch]" data-testid="decks-empty">
          <p className="display text-[1.8rem] leading-tight">No decks yet.</p>
          <p className="mt-2 text-muted">Brew one around a card few people play, or import a deck code to rate it and look for swaps.</p>
        </div>
      )}

      <div className="mt-6 grid grid-cols-[repeat(auto-fill,minmax(440px,1fr))] gap-5">
        {decks?.map((d) => (
          <article key={d.id} className="group rounded-2xl border border-line bg-panel p-4 hover:border-muted" data-testid="deck-tile">
            <div className="flex items-start gap-3">
              <Link href={`/deck/${d.id}`} className="min-w-0 flex-1">
                <h2 className="display truncate text-[1.35rem] leading-tight">{d.name}</h2>
                <p className="text-[0.78rem] text-faint">{fmtDate(d.updatedAt)}</p>
              </Link>
              <div className="flex items-center gap-2">
                <span className="display text-[1.8rem] leading-none" style={{ color: RATING_COLOR[ratingBand(d.rating)] }} title="Rating (heuristic, uncalibrated)" data-testid="tile-rating">{d.rating}</span>
                <BandChip band={d.band} novelty={d.novelty} />
              </div>
            </div>
            <Link href={`/deck/${d.id}`} className="mt-2 block" aria-label={`Open ${d.name}`}>
              <DeckArtGrid ids={d.cards} lookup={lookup} />
            </Link>
            <div className="mt-2 flex items-center gap-2 text-[0.8rem]">
              <span className={d.legal ? 'text-r-top' : d.complete ? 'text-r-low' : 'text-r-mid'} data-testid="tile-legal">
                {d.legal ? 'Legal' : d.complete ? 'Not legal' : `${d.cards.length} of 12 cards`}
              </span>
              <span className="text-faint">{d.format}</span>
              <span className="flex-1" />
              <button type="button" className="btn btn-quiet btn-sm opacity-0 group-hover:opacity-100 focus:opacity-100" onClick={() => remove(d)}>Delete</button>
            </div>
          </article>
        ))}
      </div>
      {importing && <ImportDialog onClose={() => setImporting(false)} />}
    </div>
  );
}
