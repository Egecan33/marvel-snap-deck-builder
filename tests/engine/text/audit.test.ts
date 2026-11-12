import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseCard } from '@/engine/text/parse';
import { applyOverrides, loadOverrides } from '@/engine/text/overrides';
import type { Clause } from '@/engine/types';
import { fixtureDb } from '../../helpers/fixture-db';

interface AuditClause { trigger: string; effects: [string, string][] }
interface AuditCard { defId: string; why: string; text: string; clauses: AuditClause[] }
const audit = JSON.parse(readFileSync(fileURLToPath(new URL('../../fixtures/clause-audit.json', import.meta.url)), 'utf8')) as { cards: AuditCard[] };
const overridesFile = JSON.parse(readFileSync(fileURLToPath(new URL('../../../sync-data/card-overrides.json', import.meta.url)), 'utf8'));

const key = (c: { trigger: string; effects: [string, string][] }): string => `${c.trigger}: ${c.effects.map((e) => e.join(' ')).sort().join(', ')}`;
const shape = (clauses: readonly Clause[]): string[] =>
  clauses.filter((c) => c.effects.length > 0).map((c) => key({ trigger: c.trigger, effects: c.effects.map((e) => [e.kind, e.target]) }));

/** Card-level agreement of `read` with the hand-verified audit; the misses name card, expected and read. */
export function auditScore(read: (defId: string) => readonly Clause[]): { matched: number; total: number; misses: string[] } {
  const misses: string[] = [];
  for (const a of audit.cards) {
    const want = a.clauses.map(key);
    const got = shape(read(a.defId));
    if (JSON.stringify(want) !== JSON.stringify(got)) misses.push(`${a.defId}\n  text: ${a.text}\n  want: ${want.join(' | ')}\n  got:  ${got.join(' | ')}`);
  }
  return { matched: audit.cards.length - misses.length, total: audit.cards.length, misses };
}

describe('clause audit (tests/fixtures/clause-audit.json)', () => {
  const db = fixtureDb();

  it('has at least 80 released cards whose stored text is the synced text', () => {
    expect(audit.cards.length).toBeGreaterThanOrEqual(80);
    expect(new Set(audit.cards.map((c) => c.defId)).size).toBe(audit.cards.length);
    for (const a of audit.cards) {
      const card = db.get(a.defId);
      expect(card?.cardClass, a.defId).toBe('released');
      expect(card?.text, a.defId).toBe(a.text);
    }
  });

  it('the parser alone reads trigger, kind and target right on at least 95% of audited cards', () => {
    const r = auditScore((id) => parseCard(db.get(id)!).clauses);
    if (r.misses.length) console.info(`parser audit ${r.matched}/${r.total}\n${r.misses.join('\n')}`);
    expect(r.matched / r.total).toBeGreaterThanOrEqual(0.95);
  });

  it('parser plus reviewed overrides reads every audited card right', () => {
    const overrides = loadOverrides(overridesFile);
    const r = auditScore((id) => {
      const card = db.get(id)!;
      return applyOverrides(card, parseCard(card), overrides).clauses;
    });
    if (r.misses.length) console.info(`audit with overrides ${r.matched}/${r.total}\n${r.misses.join('\n')}`);
    expect(r.matched).toBe(r.total);
  });
});
