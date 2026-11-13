'use client';

import type { Fix, Line, SwapProposal } from '@/engine/types';
import { Prov } from '../../components/card';
import { NoveltyEvidence, names } from '../../components/deck';
import type { AnalyzeResponse, Lookup } from '../../lib/api';
import { pct } from '../../lib/ui';
import { techLabel } from '../../lib/vocab';

export type PanelId = 'rating' | 'novelty' | 'plan' | 'lines' | 'network' | 'field' | 'improve';
export const PANELS: { id: PanelId; label: string }[] = [
  { id: 'rating', label: 'Rating' },
  { id: 'novelty', label: 'Novelty' },
  { id: 'plan', label: 'Plan' },
  { id: 'lines', label: 'Lines' },
  { id: 'network', label: 'Network' },
  { id: 'field', label: 'Field' },
  { id: 'improve', label: 'Improve' },
];

const H = ({ children }: { children: React.ReactNode }) => <h3 className="display mb-1.5 mt-5 text-[1.15rem] first:mt-0">{children}</h3>;

function CardLink({ id, lookup, onOpen }: { id: string; lookup: Lookup; onOpen: (id: string) => void }) {
  return (
    <button type="button" className="font-semibold hover:text-nov-offmeta" onClick={() => onOpen(id)}>
      {lookup[id]?.name ?? id}
    </button>
  );
}

function LineList({ lines, empty, testId }: { lines: Line[]; empty: string; testId?: string }) {
  if (!lines.length) return <p className="text-[0.85rem] text-faint">{empty}</p>;
  return (
    <ul className="space-y-1.5" data-testid={testId}>
      {lines.map((l, i) => (
        <li key={i} className="flex gap-2 text-[0.85rem]" title={l.reason}>
          <Prov p={l.provenance} />
          <span className="min-w-0 flex-1">
            {l.text}
            {l.probability !== null && !l.text.includes('%') && <span className="ml-1 text-muted">({pct(l.probability)})</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------------------------

export function RatingPanel({ a, onFix }: { a: AnalyzeResponse; onFix: (f: Fix) => void }) {
  const errors = a.violations.filter((v) => v.severity === 'error');
  const others = a.violations.filter((v) => v.severity !== 'error');
  return (
    <div data-testid="panel-rating">
      <p className="text-[0.85rem] text-muted">
        <Prov p="heuristic" /> The rating weighs the parts below. It is not calibrated against win rates: a meta list and a brew with the same number are not
        known to be equally strong.
      </p>
      <H>Parts</H>
      <ul className="space-y-3">
        {a.rating.subscores.map((s) => (
          <li key={s.key} data-testid="subscore">
            <div className="flex items-center gap-2 text-[0.88rem]">
              <Prov p={s.provenance} />
              <span className="flex-1 font-semibold">{s.label}</span>
              <span className="h-1.5 w-28 overflow-hidden rounded bg-line"><span className="block h-full bg-r-good" style={{ width: `${Math.round(s.value * 100)}%` }} /></span>
              <span className="w-16 text-right tabular-nums" title={`${Math.round(s.value * 100)}% of its weight ${s.weight}`}>{(s.value * s.weight).toFixed(1)} / {s.weight}</span>
            </div>
            {s.fixes.length > 0 && (
              <ul className="ml-7 mt-1 space-y-0.5 text-[0.82rem] text-muted">
                {s.fixes.map((f, i) => (
                  <li key={i}>
                    {f.text}
                    {f.filter && (
                      <button type="button" className="ml-2 text-nov-offmeta hover:underline" onClick={() => onFix(f)} data-testid="fix-filter">find cards</button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>

      <H>Rules</H>
      {!a.formatChecked && <p className="mb-1 text-[0.85rem] text-r-mid">This mode&apos;s restrictions are not verified: only the Ranked rules are checked.</p>}
      {errors.length === 0 && others.length === 0 && <p className="text-[0.85rem] text-r-top">Legal: 12 different released cards.</p>}
      <ul className="space-y-1 text-[0.85rem]">
        {[...errors, ...others].map((v, i) => (
          <li key={i} className={v.severity === 'error' ? 'text-r-low' : v.severity === 'warning' ? 'text-r-mid' : 'text-muted'}>
            {v.message}
            {v.heuristic && <span className="ml-1 text-faint">(heuristic)</span>}
          </li>
        ))}
      </ul>

      <H>Power floor</H>
      <p className="mb-1 text-[0.82rem] text-muted">The checks every brew must pass. {a.floor.passed ? 'This deck passes all of them.' : 'This deck fails at least one.'}</p>
      <ul className="space-y-1 text-[0.82rem]" data-testid="floor-checks">
        {a.floor.checks.map((c) => (
          <li key={c.key} className="flex gap-2">
            <span className={`w-4 shrink-0 font-bold ${c.passed ? 'text-r-top' : 'text-r-low'}`}>{c.passed ? '✓' : '✗'}</span>
            <Prov p={c.provenance} />
            <span><b>{c.label}.</b> <span className="text-muted">{c.detail}</span></span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function NoveltyPanel({ a, lookup, onOpen }: { a: AnalyzeResponse; lookup: Lookup; onOpen: (id: string) => void }) {
  return (
    <div data-testid="panel-novelty">
      <NoveltyEvidence nov={a.novelty} lookup={lookup} onOpen={onOpen} />
    </div>
  );
}

export function PlanPanel({ a, lookup, onOpen }: { a: AnalyzeResponse; lookup: Lookup; onOpen: (id: string) => void }) {
  const plans = [a.plans.primary, a.plans.secondary].filter((p) => p !== null);
  const e = a.energy;
  const maxCurve = Math.max(1, ...e.curve);
  return (
    <div data-testid="panel-plan">
      {plans.length === 0 && <p className="text-[0.88rem] text-r-mid">No plan reaches 60% assembly. See the Rating panel for the closest one and what it is missing.</p>}
      {plans.map((p, i) => (
        <section key={p.planId} className="mb-4">
          <H>{i === 0 ? 'Primary' : 'Secondary'}: {p.name}</H>
          <p className="text-[0.85rem]"><Prov p="derived" /> Assembled by turn {p.keyTurn} in {pct(p.assembly)} of games (exact odds over heuristic families); strength {Math.round(p.strength * 100)} <Prov p="heuristic" /></p>
          <p className="mt-1 text-[0.85rem]"><span className="text-muted">Enablers:</span> {p.enablers.map((id, k) => <span key={id}>{k > 0 && ', '}<CardLink id={id} lookup={lookup} onOpen={onOpen} /></span>)}</p>
          <p className="text-[0.85rem]"><span className="text-muted">Payoffs:</span> {p.payoffs.map((id, k) => <span key={id}>{k > 0 && ', '}<CardLink id={id} lookup={lookup} onOpen={onOpen} /></span>)}</p>
          <p className="mt-1 text-[0.85rem] text-muted">{p.takesLocations}</p>
          {p.singleCardDependence && <p className="text-[0.85rem] text-r-mid">Leans on one card: {lookup[p.singleCardDependence]?.name ?? p.singleCardDependence}.</p>}
          {p.foldsTo.length > 0 && (
            <ul className="mt-1 text-[0.82rem] text-muted">
              {p.foldsTo.map((f) => (
                <li key={f.role}>Folds to {techLabel(f.role).toLowerCase()}: {names(lookup, f.cards) || 'cards of that role'}{f.fieldShare !== null && <> , in {pct(f.fieldShare)} of games <Prov p="measured" /></>}</li>
              ))}
            </ul>
          )}
        </section>
      ))}
      {a.plans.offPlan.length > 0 && <p className="text-[0.85rem] text-muted">Off-plan: {names(lookup, a.plans.offPlan)}.</p>}

      <H>Energy</H>
      <p className="text-[0.85rem]"><Prov p="derived" /> Spends {e.expectedSpent.toFixed(1)} of 21 energy on average (energy model, heuristic play rules); average cost {e.avgCost.toFixed(2)}.</p>
      <div className="mt-2 flex h-20 items-end gap-1.5" aria-label="Curve">
        {e.curve.map((n, c) => (
          <div key={c} className="flex flex-1 flex-col items-center gap-0.5">
            <span className="text-[0.72rem] text-muted">{n || ''}</span>
            <div className="w-full rounded-t bg-energy/80" style={{ height: `${(n / maxCurve) * 52}px` }} />
            <span className="text-[0.72rem] text-faint">{c === 7 ? '7+' : c}</span>
          </div>
        ))}
      </div>
      <table className="mt-3 w-full text-[0.82rem]">
        <thead><tr className="text-left text-faint"><th className="w-12 font-normal">Turn</th><th className="w-20 font-normal">No play</th><th className="font-normal">Likely plays</th></tr></thead>
        <tbody>
          {[1, 2, 3, 4, 5, 6].map((t) => (
            <tr key={t} className="border-t border-line/60">
              <td className="py-1">{t}</td>
              <td className={(e.pNoPlay[t] ?? 0) > 0.15 ? 'text-r-mid' : 'text-muted'}>{pct(e.pNoPlay[t] ?? 0)}</td>
              <td>{names(lookup, e.likelyPlays[t] ?? [])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function LinesPanel({ a }: { a: AnalyzeResponse }) {
  const l = a.lines;
  return (
    <div data-testid="panel-lines">
      <H>Turn by turn</H>
      <LineList lines={l.turns} empty="Add cards to see a turn plan." testId="lines-turns" />
      <H>Assembly</H>
      <LineList lines={l.assembly} empty="No plan to assemble." />
      <H>Sequencing</H>
      <LineList lines={l.sequencing} empty="No ordering found between deck cards." />
      <H>Locations</H>
      <LineList lines={l.locations} empty="No location shape found." />
      <H>Risks</H>
      <LineList lines={l.risks} empty="No risk found." />
    </div>
  );
}

export function NetworkPanel({ a, lookup }: { a: AnalyzeResponse; lookup: Lookup }) {
  return (
    <div data-testid="panel-network">
      <p className="text-[0.82rem] text-muted"><Prov p="heuristic" /> Pairs come from the interaction network (rules over the parsed text). Open a card for its partners and reasons.</p>
      <H>Packages in the deck</H>
      <LineList lines={a.lines.packages} empty="No package found." />
      <H>One card away</H>
      <LineList lines={a.lines.oneAway} empty="Nothing is one card away." />
      <H>Hidden gems near this deck</H>
      {a.gemsNear.length === 0 && <p className="text-[0.85rem] text-faint">No gem pair touches this deck{a.novelty.claimsWithheld ? ` (${a.novelty.claimsWithheld})` : ''}.</p>}
      <ul className="space-y-1 text-[0.85rem]">
        {a.gemsNear.slice(0, 8).map((g) => (
          <li key={g.cards.join('|')}>
            <b>{names(lookup, g.cards)}</b> <span className="text-muted">gem {Math.round(g.gem)}: {g.reason}</span>
            {g.warning && <span className="block text-r-mid">{g.warning}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function FieldPanel({ a }: { a: AnalyzeResponse }) {
  return (
    <div data-testid="panel-field">
      <p className="text-[0.82rem] text-muted">The most played archetypes of the synced meta and how this deck meets them. No win-rate matrix is claimed.</p>
      <H>Against the field</H>
      <LineList lines={a.lines.field} empty="No meta lists synced." />
      <H>Tech choices</H>
      <LineList lines={a.lines.tech} empty="No uncovered tech role." />
    </div>
  );
}

export interface ProposalState { direction: 'stronger' | 'more-original'; swaps: SwapProposal[] }

export function ImprovePanel({ state, busy, lookup, onRun, onAccept, onReject, onOpen }: {
  state: ProposalState | null; busy: boolean; lookup: Lookup;
  onRun: (d: 'stronger' | 'more-original') => void; onAccept: (s: SwapProposal) => void; onReject: (s: SwapProposal) => void; onOpen: (id: string) => void;
}) {
  const delta = (a: number, b: number) => {
    const d = Math.round(b - a);
    return <span className={d > 0 ? 'text-r-top' : d < 0 ? 'text-r-low' : 'text-muted'}>{d > 0 ? `+${d}` : d}</span>;
  };
  return (
    <div data-testid="panel-improve">
      <p className="text-[0.85rem] text-muted">Ordered one-card swaps, checked against the power floor. Locked cards are never cut. Accept or reject them one at a time.</p>
      <div className="mt-3 flex gap-2">
        <button type="button" className="btn" disabled={busy} onClick={() => onRun('stronger')} data-testid="improve-stronger">Make it stronger</button>
        <button type="button" className="btn" disabled={busy} onClick={() => onRun('more-original')} data-testid="improve-original">Make it more original</button>
      </div>
      {busy && <p className="mt-3 text-muted">Looking for swaps…</p>}
      {state && !busy && state.swaps.length === 0 && <p className="mt-3 text-[0.88rem]">No swap {state.direction === 'stronger' ? 'raises the rating' : 'raises novelty without costing rating'}.</p>}
      <ol className="mt-3 space-y-3">
        {state?.swaps.map((s) => (
          <li key={`${s.out}>${s.in}`} className="rounded-lg border border-line p-3" data-testid="swap">
            <div className="flex items-center gap-2 text-[0.9rem]">
              <span className="text-r-low">−</span><CardLink id={s.out} lookup={lookup} onOpen={onOpen} />
              <span className="text-faint">for</span>
              <span className="text-r-top">+</span><CardLink id={s.in} lookup={lookup} onOpen={onOpen} />
              <span className="flex-1" />
              <span className="text-[0.8rem]">rating {Math.round(s.ratingBefore)}→{Math.round(s.ratingAfter)} ({delta(s.ratingBefore, s.ratingAfter)})</span>
              <span className="text-[0.8rem]">novelty {Math.round(s.noveltyBefore)}→{Math.round(s.noveltyAfter)} ({delta(s.noveltyBefore, s.noveltyAfter)})</span>
            </div>
            <p className="mt-1 text-[0.82rem] text-muted">{s.reason}</p>
            <div className="mt-2 flex gap-2">
              <button type="button" className="btn btn-sm" onClick={() => onAccept(s)} data-testid="swap-accept">Accept</button>
              <button type="button" className="btn btn-quiet btn-sm" onClick={() => onReject(s)} data-testid="swap-reject">Reject</button>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
