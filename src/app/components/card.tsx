'use client';

import { useEffect, useState, type ReactNode } from 'react';
import type { CardScore, NoveltyReport, Provenance } from '@/engine/types';
import { imageUrl, type CardView } from '../lib/api';
import { BAND_RANGE, PROVENANCE, SERVER_PLACEHOLDER_WIDTH, bandLabel, ratingBand } from '../lib/ui';
import { useStatus } from './Shell';

export const RATING_COLOR = { top: 'var(--color-r-top)', good: 'var(--color-r-good)', mid: 'var(--color-r-mid)', low: 'var(--color-r-low)' } as const;
export const BAND_COLOR: Record<NoveltyReport['band'], string> = {
  meta: 'var(--color-nov-meta)',
  variant: 'var(--color-nov-variant)',
  'off-meta': 'var(--color-nov-offmeta)',
  brew: 'var(--color-nov-brew)',
  unknown: 'var(--color-faint)',
};

/** A small M / D / H square that says how a number was obtained (spec §4). */
export function Prov({ p }: { p: Provenance }) {
  const v = PROVENANCE[p];
  return (
    <span className={`prov prov-${p}`} title={v.title} aria-label={v.label} data-testid="prov">
      {v.mark}
    </span>
  );
}

type Minimal = Pick<CardView, 'defId' | 'name' | 'cost' | 'power'>;

/**
 * Card art from data/images with the cost (blue, top left) and Power (orange, top right) drawn
 * on top: the art carries neither. A missing image becomes a tile with the name, cost and Power.
 */
export function CardArt({ card, id, children }: { card: Minimal | undefined; id: string; children?: ReactNode }) {
  const { noArt } = useStatus();
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [id]);
  const missing = failed || noArt.has(id) || !card;
  const name = card?.name ?? id;
  return (
    <div className="card" data-testid="card-art" data-id={id}>
      {missing ? (
        <div className="card-missing" data-testid="card-placeholder">
          <span>{name}</span>
          <small>{card ? 'No image on disk' : 'Not in the card database'}</small>
        </div>
      ) : (
        <img
          src={imageUrl(id)}
          alt={name}
          draggable={false}
          decoding="async"
          loading="lazy"
          onError={() => setFailed(true)}
          onLoad={(e) => e.currentTarget.naturalWidth === SERVER_PLACEHOLDER_WIDTH && setFailed(true)}
        />
      )}
      {card && (
        <>
          <span className="pip pip-cost" aria-label={`Cost ${card.cost}`} data-testid="pip-cost">{card.cost}</span>
          <span className={`pip pip-power ${card.power < 0 ? 'neg' : ''}`} aria-label={`Power ${card.power}`} data-testid="pip-power">{card.power}</span>
        </>
      )}
      {children}
    </div>
  );
}

/** Per-card score 0-100 (heuristic): green 80+, yellow 60-79, amber 40-59, red below, grey when gated. */
export function ScoreBadge({ score, className = '' }: { score: CardScore | undefined | null; className?: string }) {
  if (!score) return null;
  const bg = score.gate ? 'var(--color-faint)' : RATING_COLOR[ratingBand(score.score)];
  return (
    <span
      data-testid="score-badge"
      title={score.gate ? score.gate.message : `Score ${score.score} of 100 for this deck (heuristic)`}
      className={`display inline-flex h-[1.4rem] min-w-[1.8rem] items-center justify-center rounded-[5px] px-1 text-[0.95rem] leading-none text-[#120f22] shadow-[0_1px_3px_rgb(0_0_0/0.7)] ${className}`}
      style={{ background: bg }}
    >
      {score.gate ? '–' : score.score}
    </span>
  );
}

/**
 * A three-quarter dial. Rating and novelty use the same shape and different colours, side by side
 * and never merged (spec §4: novelty is not strength).
 */
export function Dial({
  value, label, color, size = 112, sub, testId, claimed = true,
}: { value: number; label: string; color: string; size?: number; sub?: ReactNode; testId?: string; claimed?: boolean }) {
  const v = Math.max(0, Math.min(100, value));
  const r = 40;
  const arc = Math.PI * 1.5 * r;
  return (
    <div className="flex flex-col items-center" data-testid={testId}>
      <div className="relative" style={{ width: size, height: size * 0.86 }}>
        <svg viewBox="0 0 100 86" width={size} height={size * 0.86} aria-hidden>
          <path d="M21.7 78.3 A40 40 0 1 1 78.3 78.3" fill="none" stroke="var(--color-line)" strokeWidth="9" strokeLinecap="round" />
          {claimed && v > 0 && (
            <path
              d="M21.7 78.3 A40 40 0 1 1 78.3 78.3"
              fill="none"
              stroke={color}
              strokeWidth="9"
              strokeLinecap="round"
              strokeDasharray={`${(v / 100) * arc} ${arc * 2}`}
              style={{ transition: 'stroke-dasharray 0.35s ease-out' }}
            />
          )}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center pt-1">
          <span className="display leading-none" style={{ fontSize: size * 0.34, color: claimed ? undefined : 'var(--color-faint)' }} data-testid={testId ? `${testId}-value` : undefined}>
            {claimed ? Math.round(v) : '–'}
          </span>
        </div>
      </div>
      <span className="-mt-1 text-[0.78rem] text-muted">{label}</span>
      {sub}
    </div>
  );
}

export function BandChip({ band, novelty }: { band: NoveltyReport['band']; novelty?: number }) {
  return (
    <span
      className="display inline-flex items-center gap-1 rounded-full px-2 py-[1px] text-[0.85rem] text-[#140d22]"
      style={{ background: BAND_COLOR[band] }}
      title={`Novelty band: ${bandLabel(band)} (${BAND_RANGE[band]})`}
      data-testid="band-chip"
      data-band={band}
    >
      {bandLabel(band)}
      {novelty !== undefined && band !== 'unknown' && <span className="font-sans text-[0.72rem] font-semibold not-italic opacity-75">{novelty}</span>}
    </span>
  );
}

/** Modal layer. Esc and a click on the backdrop close it. */
export function Overlay({ onClose, children, label, wide = false }: { onClose: () => void; children: ReactNode; label: string; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-[rgb(10_8_22/0.82)] p-6 backdrop-blur-[2px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      data-testid="overlay"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className={`thin-scroll max-h-full max-w-full overflow-auto rounded-xl border border-line bg-panel shadow-2xl ${wide ? 'w-[64rem]' : 'w-[40rem]'}`}
      >
        {children}
      </div>
    </div>
  );
}
