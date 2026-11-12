/**
 * Turns a card `description` from the game data into plain text.
 *
 * Markup seen in the data (docs/research/data-sources.md §1.1): `<b>`, `<i>`, `<color=#...>`,
 * `<sprite=N>` and `\n` line breaks. Bold keyword headers keep their words and colon, so
 * `<b>On Reveal:</b> Draw` becomes `On Reveal: Draw`. A description that is nothing but italic
 * text is flavour on a card without an ability and becomes ''.
 */

const TAG = /<\/?[a-zA-Z][^<>]*>/g;
/** Placeholder for a mid-sentence sprite while angle brackets are being removed. */
const ARROW = '\u0001';

export function cleanText(description: string | null | undefined): string {
  if (!description) return '';
  let s = description.replace(/\r?\n/g, ' ');

  // Flavour only: once colour wrappers are gone the whole text is one italic span.
  const bare = s.replace(/<\/?color[^<>]*>/gi, '').trim();
  if (/^<i>(?:(?!<\/?i>).)*<\/i>$/i.test(bare)) return '';

  // A red "!" in front of the text marks placeholder text on unreleased rows; it is not card text.
  s = s.replace(/<color=#[0-9a-f]+>\s*!\s*<\/color>/gi, ' ');
  // Objective cards: "<sprite=4> Objective: X <sprite=0> reward". The sprite in front of the
  // header is an icon and is dropped; a sprite between goal and reward is kept as an arrow.
  s = s.replace(/<sprite=\d+>\s*(?=<b>\s*Objective)/gi, ' ');
  s = s.replace(/^\s*<sprite=\d+>/i, ' ');
  s = s.replace(/<sprite=\d+>/gi, ARROW);
  s = s.replace(TAG, '');
  s = s.replace(/[<>]/g, ' ');
  s = s.replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"');
  s = s.replace(/\s+/g, ' ').trim();
  s = s.replace(/\s+([:.,;])/g, '$1');
  return s.split(ARROW).map((part) => part.trim()).filter(Boolean).join(' -> ');
}

/** A reviewed complete text for a card whose source description drops a number (data §1.1). */
export interface TextFix { rawText: string; text: string }

/** The fix for a row, only while the source description is still the one that was reviewed. */
export function textFixFor(defId: string, description: string | null | undefined, fixes: Readonly<Record<string, TextFix>> | undefined): string | null {
  const fix = fixes && Object.prototype.hasOwnProperty.call(fixes, defId) ? fixes[defId] : undefined;
  return fix && typeof fix.text === 'string' && fix.rawText === description ? fix.text : null;
}

// Counters and values the source leaves empty: "(/6)", "(+)", "a random -Cost or more card".
const HOLES_IN_TEXT = [/\(\s*\/\s*\d+\s*\)/, /\(\s*[+-]\s*\)/, /(^|[\s(])-Cost\b/];
// Seen only before whitespace is collapsed: "cost  from your deck", "It costs ." A line break
// next to a space is layout, not a hole, so each source line is checked on its own.
const HOLES_IN_SOURCE = [/\S {2,}\S/, /[A-Za-z] [.,](\s|$)/];

/**
 * defIds of cards whose text has a hole where the game shows a number. Untapped's description
 * drops some dynamic values, mostly a literal 0 (data §1.1, "Trap found in verification"). A card
 * whose text was replaced by a reviewed fix is checked on the fixed text only.
 */
export function findTextHoles(cards: readonly { defId: string; text: string; rawText: string }[]): string[] {
  const out: string[] = [];
  for (const c of cards) {
    let hole = HOLES_IN_TEXT.some((re) => re.test(c.text));
    if (!hole && c.text === cleanText(c.rawText)) {
      const lines = c.rawText.replace(/<sprite=\d+>/gi, '\u0001').replace(TAG, '').split(/\r?\n/);
      hole = lines.some((line) => HOLES_IN_SOURCE.some((re) => re.test(line.replace(/\s*\u0001\s*/g, ' | '))));
    }
    if (hole) out.push(c.defId);
  }
  return out;
}
