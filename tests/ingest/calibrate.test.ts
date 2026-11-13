import { describe, expect, it } from 'vitest';
import { offMetaCards, runCalibration } from '@/ingest/calibrate';
import { fixtureDb } from '../helpers/fixture-db';

describe('calibration read-out (Task 12)', () => {
  const db = fixtureDb();

  it('draws off-meta build-around cards deterministically, under 1% list share, no skills', () => {
    const a = offMetaCards(db, 10, 7);
    expect(a).toHaveLength(10);
    expect(new Set(a).size).toBe(10);
    expect(offMetaCards(db, 10, 7)).toEqual(a);
    expect(offMetaCards(db, 10, 8)).not.toEqual(a);
    for (const id of a) {
      expect(db.get(id)?.isSkill).toBe(false);
      expect(db.meta().cardStat(id)?.listShare ?? 0).toBeLessThan(0.01);
    }
  });

  it('prints each brew or refusal and each tuned build with the cards it names', () => {
    const named = db.released().filter((c) => !c.isSkill).slice(0, 2).map((c) => c.name);
    const out = runCalibration(db, { seed: 1, count: 1, names: named });
    for (const n of named) expect(out).toContain(`## ${n} (`);
    expect(out).toMatch(/# Tuned builds around the core/);
    // Every brew section ends in a result (rating, novelty, plan, floor) or a refusal with its reason.
    const sections = out.split('\n## ').slice(1, 1 + named.length);
    for (const s of sections) expect(s).toMatch(/REFUSED .*: \S|rating \d+, novelty \d+/);
  }, 60_000);
});
