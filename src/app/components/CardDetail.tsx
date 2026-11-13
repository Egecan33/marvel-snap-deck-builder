'use client';

import { useEffect, useState } from 'react';
import type { Clause } from '@/engine/types';
import { getCard, type CardDetail as Detail } from '../lib/api';
import { SCORE_PART_LABEL, SCORE_PART_PROVENANCE, errText, isAbort, pct } from '../lib/ui';
import { axisLabel, techLabel } from '../lib/vocab';
import { CardArt, Overlay, Prov, ScoreBadge } from './card';

const words = (s: string): string => s.replace(/_/g, ' ');

function ClauseRow({ c }: { c: Clause }) {
  return (
    <li className="rounded-md border border-line bg-ink/60 px-3 py-2" data-testid="clause">
      <p className="text-[0.82rem] text-muted">&ldquo;{c.text}&rdquo;</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[0.78rem]">
        <span className="rounded bg-raised px-1.5 py-[1px] font-semibold">{words(c.trigger)}</span>
        {c.effects.length === 0 && <span className="text-faint">no effect (set-up sentence)</span>}
        {c.effects.map((e, i) => (
          <span key={i} className="rounded border border-line px-1.5 py-[1px]">
            {words(e.kind)}
            {e.magnitude !== null && <b className="ml-1">{e.magnitude}</b>}
            <span className="text-muted"> → {words(e.target)}</span>
          </span>
        ))}
        {c.conditions.map((x) => (
          <span key={x} className="rounded border border-dashed border-line px-1.5 py-[1px] text-muted">if {words(x)}</span>
        ))}
        {c.scaling.map((x) => (
          <span key={x} className="rounded border border-dashed border-line px-1.5 py-[1px] text-muted">per {words(x)}</span>
        ))}
        <span className="ml-auto text-faint" title={c.source === 'override' ? 'From the reviewed overrides file (sync-data/card-overrides.json)' : 'Read by the text parser'}>
          {c.source === 'override' ? 'reviewed override' : 'parser'}
          {!c.complete && ', partly read'}
        </span>
      </div>
    </li>
  );
}

/**
 * The card overlay of the builder (spec §16): image, text, the clauses as the engine read them,
 * score parts, partners with reasons, play rate.
 */
export function CardDetailOverlay({ id, deckIds, onClose, action }: { id: string; deckIds: string[] | null; onClose: () => void; action?: React.ReactNode }) {
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = deckIds?.join(',') ?? '';
  useEffect(() => {
    const ctrl = new AbortController();
    setD(null);
    setError(null);
    getCard(id, key ? key.split(',') : null, ctrl.signal).then(setD, (e) => !isAbort(e) && setError(errText(e)));
    return () => ctrl.abort();
  }, [id, key]);

  const f = d?.features;
  const axes = f ? Object.entries(f.axes).filter(([, a]) => a.e > 0 || a.p > 0) : [];
  return (
    <Overlay onClose={onClose} label={d?.card.name ?? 'Card'} wide>
      <div className="grid grid-cols-[300px_1fr] gap-6 p-6" data-testid="card-detail">
        <div>
          <CardArt id={id} card={d?.card} />
          {d && (
            <div className="mt-2 space-y-1 text-[0.82rem] text-muted">
              <p>{d.card.seriesLabel}{d.card.isSkill ? ', skill' : ''}{d.card.cardClass !== 'released' ? `, ${d.card.cardClass}` : ''}</p>
              <p className="flex items-center gap-1.5">
                <Prov p="measured" />
                {d.playRate ? `In ${pct(d.playRate.listShare)} of tracked meta lists (${d.playRate.lists} lists)` : 'Not in any synced meta list'}
                {d.playRate?.winDelta != null && `, win rate ${d.playRate.winDelta >= 0 ? '+' : ''}${(d.playRate.winDelta * 100).toFixed(1)} pts`}
              </p>
              {f && (
                <p className="flex items-center gap-1.5">
                  <Prov p="heuristic" /> Card quality {Math.round(f.quality)} (stats {f.qualityParts.stat.toFixed(0)}, text {f.qualityParts.text.toFixed(0)}, measured {f.qualityParts.measured.toFixed(0)})
                </p>
              )}
            </div>
          )}
          {action && <div className="mt-3">{action}</div>}
        </div>
        <div className="min-w-0">
          {error && <p className="text-r-low">{error}</p>}
          {!d && !error && <p className="text-muted">Reading the card…</p>}
          {d && (
            <>
              <div className="flex items-start gap-3">
                <h2 className="display text-[2rem] leading-none">{d.card.name}</h2>
                <ScoreBadge score={d.score} className="mt-1" />
              </div>
              <p className="mt-2 max-w-[60ch] text-[0.95rem]">{d.card.text || <span className="text-muted">No ability.</span>}</p>

              {d.score && (
                <section className="mt-4">
                  <h3 className="display text-[1.05rem]">Score in this deck</h3>
                  {d.score.gate && <p className="mt-1 text-r-low">{d.score.gate.message}</p>}
                  <ul className="mt-1 grid grid-cols-2 gap-x-6 gap-y-0.5 text-[0.82rem]">
                    {d.score.parts.map((p) => (
                      <li key={p.key} className="flex items-center gap-2">
                        <Prov p={SCORE_PART_PROVENANCE[p.key] ?? 'heuristic'} />
                        <span className="flex-1 text-muted">{SCORE_PART_LABEL[p.key] ?? p.key}</span>
                        <span>{p.points.toFixed(0)} / {p.max}</span>
                      </li>
                    ))}
                  </ul>
                  {d.score.reasons.length > 0 && (
                    <ul className="mt-2 list-disc space-y-0.5 pl-5 text-[0.82rem] text-muted">
                      {d.score.reasons.slice(0, 5).map((r) => <li key={r}>{r}</li>)}
                    </ul>
                  )}
                </section>
              )}

              <section className="mt-4">
                <h3 className="display text-[1.05rem]">What the engine read</h3>
                {f ? (
                  <>
                    <ul className="mt-1.5 space-y-1.5">{f.clauses.map((c, i) => <ClauseRow key={i} c={c} />)}</ul>
                    {f.unparsed.length > 0 && <p className="mt-1 text-[0.8rem] text-r-mid">Not read: {f.unparsed.join(' / ')}</p>}
                    <div className="mt-2 flex flex-wrap gap-1.5 text-[0.76rem]">
                      {axes.map(([id, a]) => (
                        <span key={id} className="rounded-full border border-line px-2 py-[1px]" title={a.heuristic ? 'One side is a guess from cost or Power (heuristic)' : 'Read from the card text'}>
                          {axisLabel(id)}: {[a.e > 0 && `enabler${a.e < 1 ? ' (guess)' : ''}`, a.p > 0 && `payoff${a.p < 1 ? ' (guess)' : ''}`].filter(Boolean).join(', ')}
                        </span>
                      ))}
                      {f.techRoles.map((t) => <span key={t} className="rounded-full border border-energy/60 px-2 py-[1px] text-energy">tech: {techLabel(t)}</span>)}
                      {f.restriction && <span className="rounded-full border border-r-mid/60 px-2 py-[1px] text-r-mid">restriction: {f.restriction}</span>}
                    </div>
                  </>
                ) : (
                  <p className="text-muted">No features computed for this card (run the features sync).</p>
                )}
              </section>

              <section className="mt-4">
                <h3 className="display flex items-center gap-2 text-[1.05rem]">Partners <Prov p="heuristic" /></h3>
                {d.partners.length === 0 && <p className="text-[0.85rem] text-muted">No positive interaction found in the network.</p>}
                <ul className="mt-1 space-y-1 text-[0.82rem]" data-testid="partners">
                  {d.partners.map((p) => (
                    <li key={p.defId} className="flex gap-2">
                      <span className={`w-10 shrink-0 text-right font-semibold ${p.strong ? 'text-r-top' : 'text-muted'}`}>{p.score.toFixed(2)}</span>
                      <span className="min-w-0">
                        <b>{p.card?.name ?? p.defId}</b>
                        {p.strong && <span className="ml-1 text-[0.72rem] text-r-top">strong</span>}
                        <span className="text-muted">: {p.reasons.filter((r) => r.kind === 'synergy').map((r) => r.label).join('; ')}</span>
                      </span>
                    </li>
                  ))}
                </ul>
                {d.anti.length > 0 && (
                  <>
                    <h4 className="mt-3 text-[0.85rem] font-semibold text-r-low">Works against</h4>
                    <ul className="mt-1 space-y-1 text-[0.82rem]">
                      {d.anti.map((p) => (
                        <li key={p.defId}>
                          <b>{p.card?.name ?? p.defId}</b>
                          <span className="text-muted">: {p.reasons.filter((r) => r.kind === 'anti').map((r) => r.label).join('; ')}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </Overlay>
  );
}
