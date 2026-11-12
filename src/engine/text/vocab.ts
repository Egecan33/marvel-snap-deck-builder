/**
 * Vocabulary of the card-text parser (docs/research/mechanics.md §1 and §2): the trigger, effect-kind
 * and target names a Clause can carry, and the phrase tables that recognise them.
 *
 * Every phrase below was written against card text in the synced pool. Nothing here states what a
 * card does: the tables only name wordings, and `parse.ts` attaches them to a sentence.
 */

/** When a clause happens. `static` is text with no keyword header and no recognised trigger phrase. */
export const TRIGGERS = [
  'static',
  'on_reveal', 'ongoing', 'activate', 'game_start', 'end_of_turn', 'start_of_turn', 'when_destroyed', 'when_discarded',
  'objective', 'quickdraw',
  'on_self_move', 'on_self_bounce', 'on_self_merge', 'on_self_empowered', 'on_any_empowered',
  'on_draw_self', 'on_draw_any', 'on_hand_gain',
  'on_other_destroyed', 'on_other_discarded', 'on_other_move',
  'on_opp_play', 'on_opp_no_play', 'on_any_play', 'on_own_play',
  'end_of_game', 'on_opp_bonus_energy',
  'static_cost', 'play_restriction', 'moveable', 'draw_position',
] as const;
export type Trigger = (typeof TRIGGERS)[number];

/** What an effect does (mechanics §1.3 and §2). */
export const EFFECT_KINDS = [
  'deny_on_reveal', 'repeat_on_reveal', 'repeat_ongoing', 'repeat_eot', 'repeat_activate', 'repeat_self',
  'silence', 'steal_text', 'copy_text', 'transform', 'reveal_delay', 'protect', 'lockdown', 'play_restriction',
  'loc_change', 'loc_power', 'total_power', 'switch_sides', 'grant_moveable', 'resurrect', 'bounce', 'merge',
  'junk_deck', 'gen_deck', 'junk_hand', 'junk_board', 'summon', 'copy_card', 'gen_board', 'gen_hand',
  'energy_max', 'energy_gain', 'energy_deny', 'cost_reduce', 'cost_increase', 'cost_other',
  'power_double', 'power_steal', 'power_set', 'power_absorb', 'banish', 'horde', 'afflict', 'buff',
  'deck_stack', 'deck_replace', 'expiry', 'discard', 'destroy', 'move', 'opp_draw', 'draw', 'info',
  'control', 'special',
] as const;
export type EffectKind = (typeof EFFECT_KINDS)[number];

/**
 * Who or what an effect lands on. "here" is the location this card is at; a clause triggered by this
 * card moving uses "here" for the location it arrives at.
 *
 * - `self`                 this card
 * - `own_here`             your card(s) at this location
 * - `own_anywhere`         your card(s) in play, wherever they are (also a named location: left, right, middle)
 * - `own_other_locations`  your card(s) at the other locations
 * - `own` / `enemy` / `both`  a side without a zone: where a created or summoned card arrives, whose card is revived,
 *                          side-wide cost rules ("Your created cards cost 1 less"), the Zombie Horde (`horde` -> own),
 *                          and for `loc_power` the side that gets the Power (`own_other_locations` for your side)
 * - `own_hand`, `own_deck`, `enemy_hand`, `enemy_deck`  cards in that zone
 * - `own_player`, `enemy_player`  the player (energy, draws, play limits)
 * - `own_next_played`      the next card you play
 * - `own_played_card`      the card of yours whose play triggered the clause
 * - `enemy_played_card`    the enemy card whose play triggered the clause
 * - `any_played_card`      the card (either side) whose play triggered the clause
 * - `own_drawn_card`       the card you just drew
 * - `own_moved_card`, `enemy_moved_card`, `moved_card`  the card whose move triggered the clause
 * - `enemy_here`, `enemy_anywhere`  enemy card(s) in play
 * - `all_here`, `all_anywhere`      cards of both sides in play
 * - `both`                 both players, both hands or both decks
 * - `location`             a location itself
 */
export const TARGETS = [
  'self', 'own_here', 'own_anywhere', 'own_other_locations', 'own', 'own_hand', 'own_deck', 'own_player',
  'own_next_played', 'own_played_card', 'own_drawn_card', 'own_moved_card',
  'enemy_here', 'enemy_anywhere', 'enemy_hand', 'enemy_deck', 'enemy_player', 'enemy', 'enemy_played_card', 'enemy_moved_card',
  'all_here', 'all_anywhere', 'both', 'location', 'moved_card', 'any_played_card',
] as const;
export type Target = (typeof TARGETS)[number];

/** Triggers whose clause is a standing property of the card rather than an event. */
export const STATIC_TRIGGERS: readonly string[] = ['moveable', 'draw_position', 'static_cost', 'play_restriction'];

export const HEADERS: readonly (readonly [string, readonly Trigger[]])[] = [
  ['On Reveal and When Destroyed', ['on_reveal', 'when_destroyed']],
  ['When Discarded or Destroyed', ['when_discarded', 'when_destroyed']],
  ['On Reveal', ['on_reveal']],
  ['Ongoing', ['ongoing']],
  ['Activate', ['activate']],
  ['Game Start', ['game_start']],
  ['End of Turn', ['end_of_turn']],
  ['Start of Turn (after drawing)', ['start_of_turn']],
  ['Start of Turn', ['start_of_turn']],
  ['When Destroyed', ['when_destroyed']],
  ['When Discarded', ['when_discarded']],
  ['Objective', ['objective']],
  ['Quickdraw', ['quickdraw']],
];

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const HEADER_SOURCE = '(' + HEADERS.map(([h]) => esc(h)).join('|') + '):';

/** Sentence-level triggers without a keyword header: [phrase, trigger, may replace a keyword segment's trigger]. */
export const PASSIVE: readonly (readonly [RegExp, Trigger, boolean])[] = ([
  ['^When this (card )?moves( to a location)?,?', 'on_self_move', true],
  ['^The first time this moves,?', 'on_self_move', true],
  ['^After this moves to a location,?', 'on_self_move', true],
  ['^When this returns to your hand,?', 'on_self_bounce', true],
  ['^When this merges,?', 'on_self_merge', true],
  ['^Gains (?=\\+\\d+ Power from merging)', 'on_self_merge', true],
  ['^When this is Empowered,?', 'on_self_empowered', true],
  ['^When your cards in play are Empowered,?', 'on_any_empowered', true],
  ['^When you draw this,?|^When drawn,?', 'on_draw_self', true],
  ['^When you draw a card( with \\d+ or more Power)?,?', 'on_draw_any', true],
  ['^When a card enters your hand from anywhere,?', 'on_hand_gain', true],
  ['^After one of your other cards is destroyed,?', 'on_other_destroyed', true],
  ['^When one of your cards is destroyed,?', 'on_other_destroyed', true],
  ['^After every 3rd time,?', 'on_other_destroyed', true],
  ['^(When|After) you discard a card,?', 'on_other_discarded', true],
  ['^When (a|an enemy) card moves( here)?,?', 'on_other_move', true],
  ['^The first time another one of your cards moves here each turn,?', 'on_other_move', true],
  ['^After your opponent plays (a|an)( Ongoing)? card here,?', 'on_opp_play', false],
  ['^After an enemy character is played here,?', 'on_opp_play', false],
  ["^Each turn your opponent doesn't play a card here,?", 'on_opp_no_play', false],
  ['^After ANY( \\d or \\d-Cost)? card is played here,?', 'on_any_play', false],
  ['^After you play (a|an) [^,]*?(card|skill)( here)?( with (higher Power|an On Reveal|\\d+ or more Power))?( here)?,?', 'on_own_play', false],
  ['^After the next time you play a \\d-Cost card,?', 'on_own_play', false],
  ['^Each card you play to fill your side of a location', 'on_own_play', false],
  ['^Each turn, the first card you play at another location', 'on_own_play', false],
  ['^Your cards reveal here', 'on_own_play', false],
  ['^At the end of the game,?', 'end_of_game', false],
  ['^The next time your opponent would start a turn with bonus Energy,?', 'on_opp_bonus_energy', false],
  ["^(Costs? \\d+ (less|if)|This card's cost is reduced|If a card moved last turn, this costs)", 'static_cost', true],
  ['^Double Cost reductions to this', 'static_cost', true],
  ["^(You can only play this|You can't play this|If you played a card last turn, you can't play this)", 'play_restriction', true],
  ['^Moveable( once| twice)?\\.?$', 'moveable', true],
  ['^(Starts in your opening hand|You always draw this card)', 'draw_position', true],
] as const).map(([src, trigger, override]) => [new RegExp(src), trigger, override] as const);

const table = (rows: readonly (readonly [string, string])[]): readonly (readonly [RegExp, string])[] =>
  rows.map(([src, name]) => [new RegExp(src, 'gi'), name] as const);

/** Named conditions ("if ..."). The last row is the catch-all: a clause holding `other` is not complete. */
export const CONDITIONS = table([
  ["if you're winning (here|this location)( after next turn)?( with an On Reveal card)?|each time you're winning here|where you are winning|for each location you're winning|if you'd be winning its location|if you're winning my Herald's location", 'winning_here'],
  ["if you're losing this location|to a location you're losing", 'losing_here'],
  ["if (your side of this location|your side here|your side) is full( here)?|that's full on your side|to fill your side of a location|when your side of this location is full", 'own_side_full'],
  ['if both sides here are full|if either side here is full', 'both_sides_full'],
  ['if this is your only card here|and this is your only card here|alone at another location', 'alone_here'],
  ['if your opponent played (a card|any cards) here this turn', 'opp_played_here'],
  ['if you play a card at this location next turn|if you play your next card at this location', 'play_here_next'],
  ["if you don't play a card at this location next turn", 'no_play_here_next'],
  ["if you have unspent Energy|for each turn you've ended with unspent Energy|End \\d turns in a row with unspent Energy", 'own_unspent_energy'],
  ['if your opponent has unspent Energy', 'opp_unspent_energy'],
  ["if you spent all your Energy|and spent all your Energy|if you've spent all your Energy on previous turns|for each turn in which you spent all your Energy", 'spent_all_energy'],
  ['if you played \\d cards?( this turn)?|for each turn you played \\d or more cards', 'played_n_cards'],
  ['if you played a 1-Cost card this turn', 'played_1cost'],
  ['if you played an On Reveal', 'played_on_reveal'],
  ['if you played a card last turn', 'played_last_turn'],
  ['that (wins|LOSES) you the game', 'wins_game'],
  ['if your hand is full', 'hand_full'],
  ['if your hand has 1 or fewer cards', 'hand_small'],
  ['if a card moved last turn|if you used a Moveable ability', 'moved_recently'],
  ['if your opponent discarded a card this game', 'opp_discarded'],
  ["if you've discarded a card|for each turn you've discarded a card", 'have_discarded'],
  ['if one of your cards has been destroyed', 'have_destroyed'],
  ["if you've had cards discarded and destroyed", 'have_discarded_and_destroyed'],
  ['if you have the highest Power among cards in play', 'own_highest_power'],
  ['if the last card you played has an (On Reveal|Ongoing)', 'last_played_has_keyword'],
  ['if this is at the middle location', 'at_middle'],
  ['if this is in the back row', 'in_back_row'],
  ["if it's an odd turn, otherwise give to the right location", 'odd_even_turn'],
  ["on even turns|on turn \\d|after turn \\d|until turn \\d|Doesn't work after turn \\d", 'turn_number'],
  ["if it has less Power|if it was 4-Cost or more|if it's 5-Cost or more|if it has an On Reveal", 'if_it_stat'],
  ['if your opponent has 4 cards here', 'opp_count_here'],
  ['if any of your locations are empty', 'own_empty_location'],
  ['if you have any cards with increased Power in play', 'have_increased_power'],
  ['if your opponent played a card with greater Power this turn', 'opp_played_bigger'],
  ['if a player Snapped', 'snapped'],
  ["if you can't|if your total is higher|if they have any|that can't", 'fallback'],
  ['where you have a 1-Cost card', 'have_1cost_here'],
  ['where an enemy is afflicted with negative Power', 'enemy_afflicted_here'],
  ['if your other cards in play cost exactly 8 total', 'exact_cost_total'],
  ['\\bif [^,.]*', 'other'],
]);

/** Named scaling sources ("for each ..."). `other` is the catch-all, as above. */
export const SCALING = table([
  ['for each card in your hand|each card in your hand gives', 'own_hand_size'],
  ["for each card in your opponent's hand", 'opp_hand_size'],
  ["for each card in your opponent's deck", 'opp_deck_size'],
  ['for each enemy card (here|there)', 'enemy_cards_here'],
  ['for each other card you have here|for each of your cards at the right location', 'own_cards_here'],
  ['for each( card)? destroyed( this game)?|for each location where one of your cards has been destroyed', 'destroyed_count'],
  ['for each time you discarded a card this game', 'discard_count'],
  ['for each time one of your cards moved this game|for each moved', 'move_count'],
  ['for each returned', 'bounce_count'],
  ['for each other Ongoing card you have in play', 'own_ongoing_count'],
  ['for EACH On Reveal card in play', 'on_reveal_count'],
  ['for each( of your)? unspent Energy( last turn)?', 'unspent_energy'],
  ['for each bonus Energy you have', 'bonus_energy'],
  ['for each different Cost among (them|their cards in play|your cards in play)', 'distinct_costs'],
  ['for each different Power among all other cards here', 'distinct_powers'],
  ["for each location that's full on your side", 'full_locations'],
  ['for each of your created cards in play', 'created_in_play'],
  ['for each other card you played this turn|for each card you played last turn', 'cards_played'],
  ['for each card in play afflicted with negative Power', 'afflicted_count'],
  ['for each of your cards that has 10 or more Power', 'big_power_count'],
  ['for each of your other cards in play with increased Power', 'increased_power_count'],
  ['for each \\d-Cost or more card you have here and in hand', 'big_cost_count'],
  ['for each of your front-Row characters', 'front_row_count'],
  ['for each higher-Cost card here', 'higher_cost_here'],
  ["for each Moveable card you've played", 'moveable_played'],
  ['with Cost equal to your unspent Energy', 'unspent_energy'],
  ['for each location\\b', 'locations'],
  ['for each\\b', 'each'],
  ['for each [^,.]*', 'other'],
]);

export const DURATIONS: readonly (readonly [RegExp, string])[] = table([
  ['until the end of next turn', 'until_end_of_next_turn'], ['until the game ends', 'until_game_ends'],
  ['next turn', 'next_turn'], ['this turn', 'this_turn'], ['last turn', 'last_turn'],
  ['each turn( this is in play)?', 'each_turn'], ['once per game', 'once_per_game'], ['this game', 'this_game'],
  ['as the turn starts', 'as_turn_starts'], ['after this turn', 'after_this_turn'], ['the first time', 'first_time'],
  ['\\(?if possible\\)?', 'if_possible'], ['instead', 'instead'], ['otherwise', 'otherwise'],
  ['immediately', 'immediately'], ['always', 'always'],
]);

/** Words that narrow which cards an effect picks. */
export const SELECTORS = table([
  ['highest-Power|highest Power', 'sel:highest_power'], ['lowest-Power|lowest Power', 'sel:lowest_power'],
  ['highest-Cost|that costs the most', 'sel:highest_cost'], ['lowest-Cost|that costs the least', 'sel:lowest_cost'],
  ['\\brandom(ly)?\\b|EXTREMELY random', 'sel:random'], ['leftmost', 'sel:leftmost'], ['rightmost', 'sel:rightmost'],
  ['(the )?last (card|character) (you|your opponent|EACH player) played|your card that last moved', 'sel:last_played'],
  ['(the |your )?next (card|character) you play|after you play (your next (card|character)|it|them all)', 'sel:next_played'],
  ['front-row|front row', 'sel:front_row'], ['back-row|back row', 'sel:back_row'],
  ['\\bcreated\\b|that were created in your hand', 'sel:created'],
  ['even-costed', 'sel:even_cost'], ['odd-costed', 'sel:odd_cost'],
  ['\\d(, \\d,)? (and|or) \\d-Cost( or more)?', 'sel:cost_set'],
  ['\\d-Cost or (more|higher)|that are \\d-Cost or more|that Cost \\d or more|that cost \\d or more', 'sel:cost_ge'],
  ['\\d-Cost or (less|lower)|that cost \\d or less|\\d-Cost or less', 'sel:cost_le'],
  ['\\d-Cost', 'sel:cost_eq'], ['that cost(s)? 0', 'sel:cost_eq'],
  ['(that has |with )?\\d+ or more Power', 'sel:power_ge'],
  ['with \\d+ or less Power|\\d+ or less Power|with Power below 0|with \\d Power or less|with 1 or less Power', 'sel:power_le'],
  ['with less Power( than [^.]*)?', 'sel:less_power_than_self'],
  ['with no abilities', 'sel:no_ability'], ['with increased Power', 'sel:increased_power'],
  ['afflicted with negative Power|afflicted', 'sel:afflicted'],
  ['On Reveal cards?|cards? with an On Reveal', 'sel:on_reveal_card'], ['Ongoing cards?', 'sel:ongoing_card'],
  ['Activate cards?', 'sel:activate_card'], ['End of Turn cards?', 'sel:eot_card'], ['Moveable card', 'sel:moveable_card'],
  ['When Discarded card', 'sel:when_discarded_card'],
  ['unrevealed', 'sel:unrevealed'], ["\\btop (card|character|\\d cards)\\b|deck's top card|bottom card", 'sel:top_of_deck'],
  ['with the same (Power|Cost)|costs the same or more', 'sel:same_stat'], ['\\bskill\\b', 'sel:skill'],
  ['that moved this turn|played here this turn|you revealed this turn|destroyed last turn|played this turn|played next turn', 'sel:this_turn'],
  ['\\bdifferent\\b', 'sel:different'], ['\\bfirst\\b', 'sel:first'], ['\\b(up to )?\\d+ total Cost\\b', 'sel:total_cost'],
  ["that started there|that isn't full|with the fewest cards|in front of it|\\bRocks\\b", 'sel:misc'],
  ['discarded (or|and) destroyed', 'sel:from_discarded_or_destroyed'],
  ['\\bdestroyed\\b', 'sel:from_destroyed'], ['\\b(you )?discarded\\b', 'sel:from_discarded'],
  ['\\b(you |are )?play(ed|s)?\\b', 'sel:played'],
]);

/** Phrases that name a target. They only mark words as understood; `resolveTarget` decides the target. */
export const TARGET_WORDS: readonly RegExp[] = [
  "your opponent's (hand|deck|starting deck|side of this location|side)", 'their (hand|side of this location|cards in play)',
  '(in|from|to) your hand( or deck)?', 'your (whole )?hand', '(in|into|from|of) your deck', 'your deck', "both decks|EACH deck's|in ALL hands",
  "each player('s hand)?|EACH player|the losing player's deck|Nobody|Players",
  'your opponent', 'enem(y|ies)', 'your (other )?(cards|characters)( here| in play)?', 'one of your( other)?', 'your other',
  '(ALL|all|every|each|EACH|any|ANY) (other )?(cards?|characters?)( here| in play)?', 'other cards?( here)?',
  '(at|to|in) (each|another|the) other locations?',
  '(at|to) (each|another|a random|the right|the left|the middle|this|the old|any) location(s)?( to the (left|right))?',
  '(to|on) (each|your) side of this location|on your side|your side of this location',
  'to the (right|left)|one location to the (right|left)|to random locations|a location',
  'your opening hand', 'the (left|right|middle) location', 'your lowest-Power location', '\\bhere\\b', '\\bthere\\b', 'in play',
  'this location', 'other locations', 'at each location', "this card's|this card|itself|this one",
  'from merging', 'and not before', 'to yours', 'to enemies',
  'your', 'its location', 'old location', 'its previous location', 'both', 'away', '\\blocations?\\b',
].map((src) => new RegExp(src, 'gi'));

/** Sentences that only set up the next one ("Compare ..., If your total is higher, +6 Power."): read, no effect. */
export const SETUP: readonly RegExp[] = [
  'Compare the Power of the top \\d cards of both decks', 'Judge \\d other random characters',
].map((src) => new RegExp(src, 'gi'));

/** Function words that carry no mechanic of their own. */
export const STOP: ReadonlySet<string> = new Set(
  `a an the to and then of that it its is are with from on at in this card cards character characters you
too be by for has have had their them they those these or but as would do does get gets gain gains give gives each
one two three four 1 2 3 4 5 6 12 into was were who which so can when after up out all other another new copy copies
he she him her my i me she's there's until while than more less 0 times time turns turn 's many additional reveals reveal ones`
    .split(/\s+/)
    .filter(Boolean),
);

export interface EffectRule { kind: EffectKind; rx: RegExp; fixed: Target | null }
const rule = (kind: EffectKind, src: string, fixed: Target | null = null): EffectRule => ({ kind, rx: new RegExp(src, 'gi'), fixed });

/** Effect cores. Order matters: an earlier rule claims its span of the sentence first. */
/*
 * Card-specific phrases below (AGENTS rule 2: a hardcode needs a reason). Some alternatives quote one
 * card's wording: "Replace this with \d Kangs" (Kang), 'Limbo' (Limbo), "with \"oink!\"" (Spider-Ham),
 * "Judge the worthy again", "33% chance to HULK OUT!", and the token names of gen_board (Rock, Squirrel,
 * DoomBot, ..., Cap's Shield). They stay here because each is a verb phrase of the sentence grammar, not a
 * list of cards: the parser needs the phrase to find the effect span and its target, which an override
 * (whole reviewed clauses) would also give but at the cost of freezing the card's reading against text
 * changes. The token list mirrors `Card.tokens` names: a token missing from it is not read as a
 * board add, so add its name here when the clause audit or the coverage report shows the miss.
 */
export const EFFECT_RULES: readonly EffectRule[] = [
  rule('deny_on_reveal', "On Reveal abilities won't happen here", 'location'),
  rule('repeat_on_reveal', "its ability happens again|repeat the On Reveal abilities of|the On Reveal abilities of (.*?) repeat|your On Reveal abilities here repeat|uses that card's On Reveal|Use \\d On Reveals from cards released before Rama-Tut's time|Use the highest-Cost On Reveal in your hand|repeat (this|its On Reveal) ability|Judge the worthy again"),
  rule('repeat_ongoing', 'your other Ongoing effects here apply an additional time|has the Ongoing effects of|has \\d random Ongoing abilities'),
  rule('repeat_eot', 'your End of Turn abilities repeat'),
  rule('repeat_activate', 'Immediately Activate'),
  rule('control', 'She controls your cards'),
  rule('special', '33% chance to HULK OUT!|Begin a Summoning Ritual|cast a spell|swap to a new Activate ability until one is used|mark one of your empty locations|improve this effect by \\d+', 'self'),
  rule('silence', 'remove(s)? (the|its) (text|abilities)( from| of| on)?'),
  rule('steal_text', 'steal the text (from|of)'),
  rule('copy_text', 'cop(y|ies) (its|the) text( of| from)?( like it just revealed)?|copy the text|replace the text of|with text from (a )?random cards?( of the same Cost)?( that Cost \\d or more)?|with "oink!"'),
  rule('transform', "Transform into [A-Z][\\w' ,]+|transform(s)? (into|your|those cards into)|become a copy of|unlock (the|their) potential( of)?"),
  rule('reveal_delay', "(are )?not revealed until the game ends|don't reveal( it)? until the game ends"),
  rule('protect', "can't be destroyed(, moved, or have its Power reduced)?|can't have their Power reduced|Nothing can stop you from (moving or )?playing (this|cards)( to any location| anywhere)?"),
  rule('lockdown', "you can't play cards here|Nobody can play cards|You can only play 1 card a turn|must play their first card here|is the last turn cards can be played here|Moving is the only way to add or remove a character from here|Cards can't be added to locations except by playing or moving them|can't move|you can't play them"),
  rule('play_restriction', "You can only play this( at| where)?|You can't play this( after turn \\d| at)?|you can't play this", 'self'),
  rule('loc_change', "Replace (this|each other|its) location( with (a new one|'Limbo'|this one|a random new one))?|destroy all other locations|Flood this location|Swap the positions of the other two locations", 'location'),
  rule('loc_power', '(The location to the right has|Adjacent locations have|Your opponent has [+-]\\d+ Power at each other location|Your adjacent locations with 2\\+ cards and no repeated Costs have)( [+-]\\d+ Power)?|[+-]\\d+ Power to other locations'),
  rule('total_power', 'Your total Power is doubled here|Split your total Power evenly among all locations', 'location'),
  rule('switch_sides', 'switch(es)? sides'),
  rule('grant_moveable', "(is|are|gains?|It's|and) Moveable|Moveable (once|twice)|^Moveable$|gets? [+-]\\d Power when it moves"),
  rule('resurrect', 'resurrects?|reviv(e|ed)|gets revived|regenerate|bring back|put this back|return in its next phase|return all your discarded and destroyed cards to hand'),
  rule('bounce', 'returns? (this |your [^.]*?|it )?to your hand'),
  rule('merge', 'merges? (this |it |them |cards from your deck |your [^.]*?|the last card you played )?into( this| it| one of your cards)?|merges?\\b'),
  rule('junk_deck', "Shuffle (a|\\d+) Rocks? into (your opponent's|the losing player's) deck", 'enemy_deck'),
  rule('gen_deck', "Shuffle(s)? (in )?(\\d+ |the |a )?[A-Z][\\w' ]*?(into your deck|new cards into your deck)|Shuffle in \\d Demons|Replace this with \\d Kangs|Shuffle \\d+ new cards into your deck|Shuffle the six Infinity Stones into your deck", 'own_deck'),
  rule('junk_hand', "Add (a|an|\\d) [A-Z][\\w' ]*? to your opponent's hand", 'enemy_hand'),
  rule('junk_board', "Add (a|an) [A-Z][\\w' ]*? to your opponent's side of this location|Add a card from your opponent's deck to their side of this location|Pull the lowest-Power character from your opponent's hand to their side of this location", 'enemy'),
  rule('summon', "Put a (created )?card from your hand here|Add the top card of your deck to this location|Add a \\d-Cost or less card from your deck here|add it here|Add a \\d or \\d-Cost card from your hand to each other location|add a card from your hand to the old location|flies out of your hand or deck to replace it|Runs from your hand to a random location|Replace this with a \\d-Cost card from your hand or deck|swap (it|the last card you played) with (one|a card[^.]*?) from your deck|Put an Ongoing card from your deck here|This jumps (from your deck )?to|Jump to|Recruit a card|Pull Excalibur free to here|add this to the last one's location"),
  rule('copy_card', 'cop(y|ies) (of )?(your hand|your opening hand|this|it|the enemy cards|a card|the leftmost card|one of them|the character)|Add copies of|Add a copy( of)?|two copies of this|Add an exact clone of this|Add two copies of this|Get a copy of|Copy this|Copy the|copy one of them|Copy a card|Copy your hand'),
  rule('gen_board', "Add (a |an |\\d |the )?[\\w\\-' /]*?(Rock|Squirrel|DoomBot( 2099)?|Tiger|Illusion|Void|Sinister Clone|Broodlings|Ice Cube|Sword of Fu Xi|Cap's Shield|character)(?!s? to your hand)s?( here)?( with the same Power)?|Deploy four 2-Power Drones|Create a 1-Cost card|Replace this with (the Winter Soldier|Spider-Man)"),
  rule('gen_hand', "Add (a|an|\\d|the|another) [\\w\\-' /,]*?to your hand|Add [A-Z][\\w/' ]+ to your hand|The Ten Rings starts in your hand|Fill your hand with random cards|get a Vampiric Spear|to get a random character|Add step 1 to hand|starts in your hand|add the Ebony Blade to your hand", 'own_hand'),
  rule('energy_max', "[+-]\\d+ Max Energy|lose \\d Max Energy|Set your Max Energy equal to this card's Power"),
  rule('energy_deny', "they don't get it", 'enemy_player'),
  rule('energy_gain', '\\+\\d+ Energy|steal \\d bonus Energy|that much Energy'),
  rule('cost_reduce', "-\\d+ Costs?|(?<=this )that cost 0|costs? \\d+ less|cost \\d less|costs 0|It costs 0|cards cost 0|this costs 1|Costs [13]\\b|costs 3\\b|cost is reduced by the cost of|cost a maximum of 4|Set (the|their) Costs? (and Power )?(of [^.]*?)?to [0-3]\\b|Set (its|their) Costs? to [0-3]\\b|Double Cost reductions"),
  rule('cost_increase', '\\+\\d+ Costs?|costs? \\d+ more|costs 6|Increase the Cost|cost \\d more'),
  rule('cost_other', "Costs can't be (increased|reduced)|Shuffle the base Costs|Swap the Power and Cost"),
  rule('afflict', "\\bafflict\\b[^.]*?with (that much )?negative Power( equal to this card's Power)?"),
  rule('power_double', "double (this card's|its|your Champion's) Power|with (its )?Power doubled|with double the Power|Double Power increases to this|Double the Power reductions on"),
  rule('power_steal', 'steals? (all the |\\d+ )?Power( from)?|have stolen Power'),
  rule('power_set', "Set (the |this card's |ALL cards here to )?(\\d+ )?Power( of [^.]*?)?( equal)? to( \\d+| that of| the banished card's Cost)?|and Power to \\d+|Power to \\d+|with its Power set to \\d+|Reset [^.]*? to their original Power|Invert the Power of|Set ALL cards here to \\d+ Power|Set their Power to the banished card's Cost|Set the top character of your deck's Power to \\d+"),
  rule('power_absorb', "gain(s)? (its|the) Power( of)?|Add their Power to|Add this card's Power to|with negative Power equal to this card's Power|Power equal to( this card's Power| your Zombie Horde)?|Has the combined Power of|Swap Power with|Remove that card's Power from|with that much negative Power|with negative Power equal to|with that same increase|with that card's Power"),
  rule('banish', 'banish(ed)?'),
  rule('horde', 'Horde \\+\\d+( for each)?|your Zombie Horde|Horde first if necessary', 'own'),
  rule('afflict', '\\bafflict\\b[^.]*?-\\d+ Power|split -\\d+ Power among|-\\d+ Power|\\bafflict\\b'),
  rule('buff', '\\+\\d+ Power( each)?( each time)?'),
  rule('deck_stack', 'Put your leftmost card in hand on top of your deck', 'own_hand'),
  rule('deck_replace', "Replace your deck with your opponent's starting deck", 'own_deck'),
  rule('repeat_self', 'Repeat on a different enemy', 'enemy_anywhere'),
  rule('expiry', "Doesn't work", 'self'),
  rule('discard', '\\bdiscards?\\b'),
  rule('destroy', '\\bdestroy\\b( it with a Rock)?'),
  rule('move', '\\bmoves?\\b( away| it back| there)?|pull an enemy card from here to there|follow it'),
  rule('opp_draw', 'Your opponent draws \\d cards?', 'enemy_player'),
  rule('draw', "\\bdraws?\\b( Agatha)?|Starts in your opening hand|You always draw this card|you can't draw cards"),
  rule('info', 'Tap this to see the top card of your deck|you get to see your opponent\'s plays before you make your own|You can see the unrevealed locations|Your text emotes are ruder', 'self'),
];

/** Objective requirements, by wording. */
export const OBJECTIVE_REQ: readonly (readonly [RegExp, string])[] = ([
  ['Your cards are destroyed \\d times', 'obj:destroyed'],
  ['Have \\d cards that are \\d-Cost or more in play', 'obj:big_cost_in_play'],
  ['Have a full front row at each location', 'obj:full_front_rows'],
  ['Play \\d total Cost of created cards', 'obj:created_played'],
  ['Have \\d different Powers among your other cards in play', 'obj:distinct_powers'],
  ['Cards in play are afflicted with -\\d Power', 'obj:afflicted'],
  ['Have \\d cards with no abilities in play', 'obj:no_ability'],
  ['End \\d turns in a row with unspent Energy', 'obj:unspent_energy'],
  ['Play \\d On Reveal cards', 'obj:on_reveal_played'],
  ['\\d of your cards have stolen Power', 'obj:stolen_power'],
  ['This has \\d or more Power', 'obj:self_power'],
  ['Win that location', 'obj:win_location'],
] as const).map(([src, tag]) => [new RegExp(src), tag] as const);
