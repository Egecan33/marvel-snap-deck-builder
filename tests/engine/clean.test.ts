import { describe, expect, it } from 'vitest';
import { cleanText } from '@/engine/text/clean';

describe('cleanText', () => {
  it('keeps bold keyword headers as plain structure', () => {
    expect(cleanText('<b>On Reveal:</b> Add another Sentinel to your hand.')).toBe('On Reveal: Add another Sentinel to your hand.');
    expect(cleanText('<b>When Discarded or Destroyed:</b> Regenerate this with +2 Power\nat a random location.')).toBe(
      'When Discarded or Destroyed: Regenerate this with +2 Power at a random location.',
    );
  });

  it('joins line breaks and collapses whitespace', () => {
    expect(cleanText("<b>Ongoing:</b> Cards here can't\nbe destroyed.")).toBe("Ongoing: Cards here can't be destroyed.");
    expect(cleanText('Your cards with Power below  switch sides.')).toBe('Your cards with Power below switch sides.');
  });

  it('returns an empty string for italic-only flavour text', () => {
    expect(cleanText('<i>"HULK SMASH!"</i>')).toBe('');
    expect(cleanText(' <i>"squeak!"</i>\n')).toBe('');
    expect(cleanText('<color=#fad728><i>"flavour"</i></color>')).toBe('');
    expect(cleanText('')).toBe('');
  });

  it('keeps italic remarks that follow an ability', () => {
    expect(cleanText('When a card moves, follow it to gain +2 Power. <i>(once per turn)</i>')).toBe(
      'When a card moves, follow it to gain +2 Power. (once per turn)',
    );
    expect(cleanText('<b>Start of Turn <i>(after drawing)</i>:</b> Draw.')).toBe('Start of Turn (after drawing): Draw.');
  });

  it('strips color and sprite markup', () => {
    expect(
      cleanText(
        '<sprite=4> <b>Objective:</b> Your cards are destroyed 4 times <sprite=0> Resurrect one here with +5 Power. <color=#d040ff>(/4)</color>',
      ),
    ).toBe('Objective: Your cards are destroyed 4 times -> Resurrect one here with +5 Power. (/4)');
    expect(cleanText('<color=#fad728><b>On Reveal:</b> Give the leftmost card in your hand -1 Cost.</color>')).toBe(
      'On Reveal: Give the leftmost card in your hand -1 Cost.',
    );
    expect(cleanText("<color=#ff2c2c>!</color><b>On Reveal:</b> Triple this\ncard's Power.")).toBe("On Reveal: Triple this card's Power.");
  });

  it('drops the objective icon wherever it stands and straightens curly quotes', () => {
    expect(cleanText('When drawn, mark a location.\n<sprite=4> <b>Objective:</b> Win that location <sprite=0>\n +1 Max Energy.')).toBe(
      'When drawn, mark a location. Objective: Win that location -> +1 Max Energy.',
    );
    expect(cleanText('If you’re winning here, add 2 Thief’s Tools.')).toBe("If you're winning here, add 2 Thief's Tools.");
  });

  it('leaves no angle-bracket markup behind', () => {
    expect(cleanText('<b>Ongoing</b> and <b>On Reveal</b> <size=80%>x</size>')).not.toMatch(/[<>]/);
  });
});
