import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { applyOverrides, loadOverrides } from '@/engine/text/overrides';
import { EFFECT_KINDS, TARGETS, TRIGGERS, parseCard } from '@/engine/text/parse';
import { card, fixtureDb } from '../../helpers/fixture-db';

const file = JSON.parse(readFileSync(fileURLToPath(new URL('../../../sync-data/card-overrides.json', import.meta.url)), 'utf8'));

describe('card overrides', () => {
  const gwen = card('Gwenpool');
  const reviewed = {
    Gwenpool: { reviewedText: gwen.text, note: 'test', clauses: [{ trigger: 'on_reveal', effects: [{ kind: 'buff', target: 'own_hand', magnitude: 2 }], text: gwen.text }] },
  };

  it('replaces the parse when the reviewed text is the current text', () => {
    const r = applyOverrides(gwen, parseCard(gwen), loadOverrides({ cards: reviewed }));
    expect(r.staleOverride).toBe(false);
    expect(r.unparsed).toEqual([]);
    expect(r.clauses).toHaveLength(1);
    expect(r.clauses[0]).toMatchObject({ trigger: 'on_reveal', source: 'override', complete: true, effects: [{ kind: 'buff', target: 'own_hand', magnitude: 2, selectors: [] }] });
  });

  it('ignores an override whose reviewed text differs from the synced text and reports it stale', () => {
    const changed = { ...gwen, text: gwen.text.replace('+2 Power', '+3 Power') };
    const parsed = parseCard(changed);
    const r = applyOverrides(changed, parsed, loadOverrides({ cards: reviewed }));
    expect(r.staleOverride).toBe(true);
    expect(r.clauses).toBe(parsed.clauses);
    expect(r.clauses.every((c) => c.source === 'parser')).toBe(true);
  });

  it('leaves cards without an override alone and tolerates a malformed file', () => {
    const blade = card('Blade');
    const parsed = parseCard(blade);
    expect(applyOverrides(blade, parsed, loadOverrides({ cards: reviewed }))).toEqual({ ...parsed, staleOverride: false });
    expect(loadOverrides(null)).toEqual({});
    expect(loadOverrides({ cards: { X: { clauses: [] } } })).toEqual({});
  });

  it('sync-data/card-overrides.json is current for the fixture pool and uses the parser vocabulary', () => {
    const overrides = loadOverrides(file);
    const db = fixtureDb();
    expect(Object.keys(overrides).length).toBeGreaterThan(0);
    for (const [defId, o] of Object.entries(overrides)) {
      const c = db.get(defId);
      expect(c?.cardClass, defId).toBe('released');
      expect(o.reviewedText, defId).toBe(c?.text);
      expect(o.note, defId).not.toBe('');
      for (const cl of o.clauses) {
        expect(TRIGGERS as readonly string[], defId).toContain(cl.trigger);
        for (const e of cl.effects) {
          expect(EFFECT_KINDS as readonly string[], defId).toContain(e.kind);
          expect(TARGETS as readonly string[], defId).toContain(e.target);
        }
      }
    }
  });
});
