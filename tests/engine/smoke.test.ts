import { describe, expect, it } from 'vitest';
import type { Card, CardClass } from '@/engine/types';

describe('scaffold', () => {
  it('runs tests and resolves the types contract', () => {
    const cls: CardClass = 'released';
    const card: Pick<Card, 'defId' | 'cardClass'> = { defId: 'ShangChi', cardClass: cls };
    expect(card.cardClass).toBe('released');
    expect(1 + 1).toBe(2);
  });
});
