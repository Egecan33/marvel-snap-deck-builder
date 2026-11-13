'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { CardDetailOverlay } from '../components/CardDetail';
import { CardArt, Prov } from '../components/card';
import { CorpusNote } from '../components/deck';
import { useNotify } from '../components/Shell';
import { getGems, type GemsResponse } from '../lib/api';
import { isAbort } from '../lib/ui';

/** Hidden gems (spec §13, §16): strong pairs and triples that the tracked lists rarely play together. */
export default function DiscoverPage() {
  const notify = useNotify();
  const [q, setQ] = useState('');
  const [data, setData] = useState<GemsResponse | null>(null);
  const [detail, setDetail] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    const t = setTimeout(() => getGems(q, 60, ctrl.signal).then(setData, (e) => !isAbort(e) && notify.error(e)), 200);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q, notify]);

  return (
    <div className="mx-auto max-w-[1500px] p-6">
      <div className="flex items-end gap-4">
        <div className="max-w-[70ch]">
          <h1 className="display text-[2.2rem] leading-none">Hidden gems</h1>
          <p className="mt-1 text-[0.88rem] text-muted">
            Card pairs and triples with a strong interaction that the tracked lists rarely play together. Gem = strength x how unexplored the pair is x card quality
            <Prov p="heuristic" />. Each one is a brew seed.
          </p>
        </div>
        <span className="flex-1" />
        <input className="field w-72" placeholder="Filter by card name" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter gems by card" data-testid="gems-search" />
      </div>
      {data && <div className="mt-3 max-w-[90ch]"><CorpusNote corpus={data.corpus} withheld={data.withheld} /></div>}
      {data && data.gems.length === 0 && (
        <p className="mt-8 text-muted">{data.withheld ? 'Unexplored pairs are not claimed on this corpus.' : q ? 'No gem has a card with that name.' : 'No gem found.'}</p>
      )}

      <div className="mt-5 grid grid-cols-[repeat(auto-fill,minmax(560px,1fr))] gap-5">
        {data?.gems.map((g) => {
          const byId = Object.fromEntries(g.cardViews.map((c) => [c.defId, c]));
          return (
            <article key={g.cards.join('|')} className="grid grid-cols-[auto_1fr] gap-4 rounded-2xl border border-line bg-panel p-4" data-testid="gem">
              <div className="flex">
                {g.cards.map((id) => (
                  <button key={id} type="button" className="-mx-3 w-[150px] first:ml-0" onClick={() => setDetail(id)} aria-label={byId[id]?.name ?? id}>
                    <CardArt id={id} card={byId[id]} />
                  </button>
                ))}
              </div>
              <div className="flex min-w-0 flex-col">
                <div className="flex items-baseline gap-2">
                  <span className="display text-[2rem] leading-none text-nov-brew">{Math.round(g.gem)}</span>
                  <span className="text-[0.8rem] text-muted">gem score</span>
                </div>
                <p className="mt-1 text-[0.88rem]">{g.reason}</p>
                <p className="mt-1 text-[0.82rem] text-muted">
                  <Prov p="measured" /> Seen together in {g.observed} list clusters; popularity alone predicts {g.expected.toFixed(1)}. Strength {g.strength.toFixed(2)}, unexplored {Math.round(g.unexplored * 100)}%.
                </p>
                {g.warning && <p className="mt-1 text-[0.82rem] text-r-mid">{g.warning}</p>}
                <div className="mt-auto pt-3">
                  <Link href={`/new?cards=${g.cards.map(encodeURIComponent).join(',')}`} className="btn btn-primary btn-sm" data-testid="gem-brew">Brew around this</Link>
                </div>
              </div>
            </article>
          );
        })}
      </div>
      {detail && <CardDetailOverlay id={detail} deckIds={null} onClose={() => setDetail(null)} />}
    </div>
  );
}
