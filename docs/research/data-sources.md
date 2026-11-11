# Data sources: cards, images, locations, deck codes, collection import

Researched 2026-11-12. Every URL below was requested that day with `User-Agent: SnapForge/0.1` unless stated, and the measured result is recorded. Where something could not be tested it says **not verified**.

Request count: about 60 besides the dump and the 5 images, double the planned 30. The extra went to finding deck codes (every deck page is behind a Cloudflare challenge) and to the collection-sync question.

## Summary

| Need | Primary | Fallback |
|---|---|---|
| Card data | Untapped `https://snapjson.untapped.gg/v2/latest/en/cards.json` (791 rows, 511 released collectible) | DotGG `https://api.dotgg.gg/cgfw/getcards?game=marvelsnap` (786 rows; adds ability tags, token flag, change history) |
| Card images | Untapped `https://snapjson.untapped.gg/art/render/framebreak/common/512/{defId}.webp` (512x512, about 49 KB) | DotGG `https://static.marvelsnap.pro/cards/{CardDefId}.webp` (1024x1024, about 112 KB) |
| Locations | Untapped `https://snapjson.untapped.gg/v2/latest/en/locations.json` (230) | Marvel Snap Zone `getinfo` locations (222, has released flag and rarity) |
| Deck codes | Two formats, both decoded by live sites; `analysis/deckcode/deckcode.mjs` handles both | |
| Collection | File or paste import inside Snap Forge | Manual marking with bulk toggles |

Snap-ID-only collection sync is **not possible**: no site exposes a collection by Snap ID without a login (section 5).

## 1. Card data

### 1.1 Untapped (recommended primary)

- URL: `https://snapjson.untapped.gg/v2/latest/en/cards.json`. HTTP 200, `application/json`, 378,035 bytes. `latest` redirects to the game build, today `https://snapjson.untapped.gg/v2/58.15.3/en/cards.json`, so the build number is readable from the final URL.
- Auth and headers: none. The generic User-Agent works.
- robots.txt: `snap.untapped.gg/robots.txt` is `User-agent: * / Allow: /`. `snapjson.untapped.gg/robots.txt` returns 404 (no rules).
- This is the file Untapped's own site loads (seen in its production JS, `apiV2="https://snapjson.untapped.gg/v2"`). Sibling files on the same base: `locations.json`, `artVariants.json` (5,265 variant rows, 1.06 MB), `limited-time-game-modes.json` (not fetched).
- Rows: **791**. Saved to `docs/research/raw/cards/cards.json` (gitignored).

Fields (count of rows that have the field):

| Field | Rows | Meaning |
|---|---|---|
| `defId` | 791 | The game's CardDefId, for example `ShangChi`. Use as the primary key. Only letters and digits. |
| `name` | 791 | Display name. Not unique: mode copies share names with the real card. |
| `cost`, `power` | 791 | Numbers. |
| `description` | 791 | Ability text with game markup: `<b>`, `<i>`, `<color=#...>`, `<sprite=N>`, and `\n` line breaks. Cards without an ability carry flavour text in `<i>`. |
| `series` | 791 | Number, see mapping below. 0 means not in any series. |
| `seriesStartTimestamps` | 791 | Array of epoch milliseconds, one per series the card enters. The smallest is the release date. `-62135596800000` means "always available". |
| `collectible` | 512 | `true` when present; absent otherwise. |
| `isSeasonPass` | 62 | Released first in a season pass. |
| `possibleSeries` | 35 | Series the card is scheduled to drop to. |
| `isSkill` | 61 | Skill cards (a card type without power). 11 of them are collectible and released. |
| `attributes` | 678 | Structured values behind the text: `data.*` numbers (`AddedPower`, `ReducedCost`, ...) and `cards.*` links: `Card_Token` (cards this card creates), `Card_Faction`, `Card_Base`, `Card_Source`, `Card_Related`, `Card_Modified`. |
| `artists` | 791 | `{name, type}`; type is a number 1-5 (role, not decoded). |
| `id` | 1 | Present on one row only (`Ajax`). Do not rely on it. |

`series` number to series, measured by joining all rows against DotGG's `CardSeriesDefId`: 0 none, 1 Starter, 2 Series0 (collection level 1-14), 3 Recruit, 4 Series 1, 5 Series 2, 6 Series 3, 7 Series 4, 8 Series 5, 9 SeasonPass, 10 LimitedTimeEvent. Counts today: 280, 13, 8, 5, 46, 25, 125, 91, 194, 1, 3.

Not in this source: keyword tags, a token flag, release status as a word, last-changed date, change history. Tags can be read from the bold prefix of `description` (`<b>On Reveal:</b>`), or taken from DotGG.

Classification rule (measured counts for 2026-11-12):

| Class | Rule | Count |
|---|---|---|
| Released collectible | `collectible === true` and `series > 0` and `min(seriesStartTimestamps) <= now` | 511 |
| Upcoming | not released, and some `seriesStartTimestamps` entry is in the future | 31 |
| Tokens and other non-collectible | everything else | 249 |

- The 249 "everything else" rows are tokens and summons (Squirrel, the Stones, Mjolnir), mode-only copies (44 `*Champion`, plus `*Avengers`, `*XMen`, `*WebSlingers`, ...), 31 `*Augment` draft augments, 43 non-collectible skills, 4 `*Tutorial` cards and `TestCard`. None may appear in a built deck.
- To label a row as a token specifically: its `defId` is listed in some other card's `attributes.cards.Card_Token` (118 distinct targets; 109 fall in the non-collectible class, the other 9 are real cards that another card can add, such as `Sentinel`).
- Upcoming rows carry planned dates. Dates of 2028-01-01 and 2028-01-04 are placeholders for "not scheduled". One upcoming row (`ElderDragonOfTheMoon`, 2026-11-17) already has `collectible: true` but `series: 0`, which is why the rule needs the date test.
- The rule depends on the clock, so the released set must be recomputed at sync time, never stored as a fixed list.

Freshness: contains every card released this month: `ArthurPendragon` and `CaptainBritain` and `MerlinOfAvalon` (2026-11-03), `Mordred` (2026-11-05), `Lancelot` (2026-11-10).

Cross-check: the 511 released set equals DotGG's set exactly (500 characters plus 11 skills with a started series). Marvel Snap Zone has 506 of them marked released with a series and lags on the other 5.

Full sample row:

```json
{"defId":"Wolverine","cost":2,"power":3,"name":"Wolverine","description":"<b>When Discarded or Destroyed:</b> Regenerate this with +2 Power\nat a random location.","attributes":{"data":{"AddedPower":2},"cards":{"Card_Faction":["WolverineXMen"]}},"series":4,"artists":[{"name":"Jomaro Kindred","type":1},{"name":"Ryan Kinnaird","type":4}],"seriesStartTimestamps":[-62135596800000],"collectible":true}
```

### 1.2 DotGG / marvelsnap.pro (recommended fallback and enrichment)

- URL: `https://api.dotgg.gg/cgfw/getcards?game=marvelsnap`. HTTP 200, JSON array, 3,570,341 bytes, no auth, generic User-Agent works. robots.txt of `api.dotgg.gg` was not fetched; `marvelsnap.pro/robots.txt` restricts `/builder/*/` for all agents and more paths for named crawlers.
- Rows: **786** (692 Character, 61 Skill, 31 Augment, 2 Trinket). No locations. All values are strings, and several are JSON encoded inside a string.
- Fields: `id` (CardDefId), `name`, `description` (same markup as the game), `cost`, `power`, `type`, `abilities` (JSON string of tags such as `On Reveal`, `Ongoing`, `Move`, `Destroy`, `Discard`, `Increase Power`, `Add Card`; `null` on 529 rows), `category`, `source` (`Pool 3 (Collection Level 486-?)` and similar), `CardSeriesDefId` (`Series1`..`Series5`, `Starter`, `Series0`, `Recruit`, `SeasonPass`, `LimitedTimeEvent`, `None`), `SeriesStartDates` (JSON string of `{Data, StartDate}` in epoch seconds), `is_Token` (`1` on 36 rows), `collectible`, `connected_cards`, `wasAddedIn` and `wasChangedIn` (patch labels), `latest_update` (epoch seconds), `changes` (history of `{date, cost, power, text, patch}`), `variants` (art list), colour fields.
- Traps: `collectible` is `1` on 778 of 786 rows, including tokens and mode copies, so it does **not** mean "can be put in a deck". The `0` rows are a handful of real released cards. Use `CardSeriesDefId != None` plus a started `SeriesStartDates` entry instead. Guessed sibling endpoints (`getlocations`, `getdecks`) answer `Hacker! Go home`.
- Freshness: has this month's cards; newest balance entries are dated 2026-10-29; newest `wasAddedIn` is `58.15.2`.
- Use it for: ability tags, `is_Token`, and the balance-change history. Join on `id == defId`; all 786 ids exist in the Untapped dump.

### 1.3 Marvel Snap Zone

- URL: `https://marvelsnapzone.com/getinfo/?searchtype=cards&searchcardstype=true`. HTTP 200, 3,122,452 bytes, shape `{"success":{"cards":[...]}}`, **748** rows, no auth.
- robots.txt: since 2026-08-28 it has `User-agent: * / Disallow: /getinfo/` (also `/msz-api/` and `/pro/`), and blocks AI crawlers by name. The endpoint still answers, but the site asks crawlers not to use it. This is the reason it is not recommended.
- Fields: `cid`, `name`, `carddefid`, `type`, `cost`, `power`, `ability` (HTML), `flavor`, `art`, `url`, `status` (`released` 570, `unreleased` 178), `source` and `source_slug` (`Series 1`..`Series 5`, `Starter Card`, `Recruit Season`, `Collection Level 1-14`, `None`), `tags` (`{tag_id, tag, tag_slug}`; only 10 distinct tags), `variants`, artist fields. `rarity` and `difficulty` are empty for cards. No release date, no token flag.
- Quality: `status: released` with `source: None` holds 64 rows that mix mode copies with four real cards released in the last weeks; `Lancelot` (released 2026-11-10) is still `unreleased`. Three names contain markup.
- A copy fetched by another researcher is at `raw/mechanics/cards_msz.json`.

### 1.4 Others

| Source | Result |
|---|---|
| snap.fan | `https://snap.fan/robots.txt` allows all. `https://snap.fan/cards/` is 200 (678 KB of HTML, no JSON API found); `https://snap.fan/api/cards/` is 404; `https://snap.fan/decks/` is 403 (Cloudflare challenge) with both the generic and a browser User-Agent. Usable only by scraping HTML. Not recommended. |
| GitHub `Mottelz/snapdeck` | Pushed 2026-11-07. Ships `src/models/cards.json` with 791 rows `{cardDefId, name, cost, power, description, obtainable, releaseDate, shortName}`. A second fallback if both APIs go away. |
| GitHub `jboscomendoza/marvel-snap-cards` | Last push 2025-07-17. Stale. |

## 2. Card images

Base art only; variants are not needed.

| | Untapped (primary) | DotGG (fallback, higher resolution) |
|---|---|---|
| URL | `https://snapjson.untapped.gg/art/render/framebreak/common/{size}/{defId}.webp` | `https://static.marvelsnap.pro/cards/{CardDefId}.webp` |
| Sizes | `512` and `256` tested (both 200) | fixed |
| Format | WebP with alpha, 512x512 | WebP with alpha, 1024x1024 |
| Bytes (Hulk) | 51,570 at 512; 17,836 at 256 | 111,640 |
| Hotlink / generic UA | works, no referer needed | works, no referer needed |

- The image is the full card render: frame, art breaking out of the frame, and the name logo, on a transparent background. Cost and power are not drawn on it, so the UI must overlay them.
- The pattern comes from Untapped's production JS (`getFullCardArtUrl`, default size 512). The same JS has a crop without frame: `/art/render/crop/{size}/{defId}.webp` (default 256, not fetched).
- Proof: 5 images at 512 in `raw/cards/img/`, all HTTP 200 `image/webp`: `Hulk` 51,570 bytes, `Lancelot` 48,494 (released two days ago), `ArthurPendragon` 48,708, `AdamantiumInfusion` 54,856 (a skill), `Squirrel` 40,618 (a token). Mean 48,849 bytes.
- Estimated total at 512: about 25 MB for the 511 released cards, about 39 MB for all 791 rows. At DotGG's 1024 size: about 57 MB for 511 (from one sample).
- Marvel Snap Zone's `art` URL (`.../media/cards/hulk.webp`, 1024x1024, 117,794 bytes) also works but is keyed by a name slug, not the CardDefId.
- Download serially with a pause, skip files already on disk, and treat 404 as "no art yet" for upcoming cards.

## 3. Locations

- Primary: `https://snapjson.untapped.gg/v2/latest/en/locations.json`. HTTP 200, 44,740 bytes, **230** rows. Fields: `defId`, `name`, `description`, `attributes` (149 rows), `releaseDates` (empty on every row today). Saved to `raw/cards/locations.json`. Sample: `{"defId":"AltarOfDeath","name":"Altar of Death","description":"After you play a card here, destroy it to get +2 Energy next turn.","attributes":{"data":{"AddedEnergy":2}},"releaseDates":[]}`.
- It has no released flag. If theory needs "in rotation" or rarity, Marvel Snap Zone has it: `https://marvelsnapzone.com/getinfo/?searchtype=locations&searchcardstype=true`, 200, **222** rows, same row shape as its cards, with `status` (183 released, 39 unreleased), `rarity` (common 87, uncommon 70, rare 59, ultra rare 6) and `difficulty`. Same robots.txt caveat as 1.3.
- DotGG's card endpoint has no locations.

## 4. Deck codes

### 4.1 The two formats

Both are plain base64 (standard alphabet, `=` padding) of a UTF-8 string. Always 12 cards.

**Long format (the older one).** The string is JSON:

```
{"Name":"Discard","Cards":[{"CardDefId":"Apocalypse"},{"CardDefId":"Blade"}, ... 12 entries]}
```

`Name` is optional; codes from 2022 have only `Cards`. The base64 always starts with `eyJ`. About 400 to 470 characters.

**Short format (the newer one).** The string is 12 short card codes joined by commas, no name:

```
ApclpsA,Bld5,CllnWngB,CrvsGlvC,Drcl7,Gmbt6,Khnsh7,LdSf7,Mdk5,Mrbs7,PrxmMdnghtF,Scrn5
```

A short card code is the CardDefId with every lower-case `a e i o u y` removed, followed by the length of the original CardDefId in upper-case hexadecimal: `Blade` gives `Bld5`, `Apocalypse` gives `ApclpsA`, `HighEvolutionary` (16 letters) gives `HghEvltnr10`. Upper-case vowels stay. The mapping is one-way, so decoding needs the card list: build a table from short code to CardDefId. Measured on today's dump: 791 CardDefIds give 791 distinct short codes, no collisions. About 110 to 130 characters.

### 4.2 Evidence and what is current

- Untapped's live deck builder (`https://snap.untapped.gg/en/deck-builder`, chunk `pages/deck-builder-bece618d6db4f5fb.js`, fetched today) **imports both**: it takes the first line that is not a `#` comment and looks like base64; if it starts with `ey` it parses the long JSON, otherwise it splits on commas and maps each piece through the short-code table. If there is no code it falls back to reading the `# (cost) Name` lines by card name. Its **export writes the long format** with the deck name.
- The short-code function in Untapped's `_app` chunk is, verbatim in behaviour, `id.replace(/[aeiouy]/g,"") + id.length.toString(16).toUpperCase()`.
- `github.com/Mottelz/snapdeck` (pushed 2026-11-07) implements the same two formats with the same function and calls them "short" and "long"; its generated block uses the short one.
- Verdict: the short format is the current one and the long format is still read and still written by a major live site in November 2026. Snap Forge should accept both on paste and offer both on copy, short first.
- **Not verified**: which format the game client's own copy button emits today, and whether the client still accepts a pasted long code. No in-game test was possible. Untapped exporting long codes today suggests the client still takes them.
- **Not verified with a live short code string**: every page that shows a code was unreachable. `marvelsnapzone.com/decks/*`, `snap.fan/decks/`, `marvelsnap.pro/decks/` and `noff.gg/marvel-snap/decks` all return 403 with a Cloudflare "Just a moment..." challenge, with the generic and with a browser-like User-Agent. The challenge was not worked around. Untapped's deck list pages return card lists without code strings.

### 4.3 Script and proof

`docs/research/analysis/deckcode/deckcode.mjs` (Node, no dependencies) exports `shortName`, `encodeShort`, `encodeLong`, `buildIndex`, `decode`, `formatBlock`. `node deckcode.mjs --selftest` reads `raw/cards/cards.json` and passed 28 checks on 2026-11-12:

- 3 real long codes taken from `https://www.denofgeek.com/games/best-marvel-snap-decks-you-have-to-try/` (published 2022-11-18; the page has 6): each decodes to 12 CardDefIds that all still exist in today's dump, and round-trips through both formats.
- The short and long sample pair from `snapdeck` (`src/helpers/sample.ts`): both decode to the same 12 cards, and `encodeShort` and `encodeLong` reproduce each string byte for byte.
- 4 live meta decks from `https://snap.untapped.gg/en/meta/decks` (card lists from the page's `__NEXT_DATA__`, last modified 2026-11-11): encode to short and long, decode back, decode from the full text block, and decode from the `# (cost) Name` lines alone.

### 4.4 Plain-text list next to the code

```
# (1) Misty Knight
# (1) Sunspot
# (2) Armor
...
# (6) Hulk
#
U25zcHQ3LE1zdEtuZ2h0QixBcm1yNSxTY3JwbjgsU2hja3I3LENjbHBzNyxTaG5nQ2g4LEhnaEV2bHRucjEwLFRoVGhuZzgsRW5jaG50cnNzQixBYm1udG5CLEhsazQ=
#
# (a free comment line, different per site)
```

One `# (cost) Display Name` line per card sorted by cost then name, a bare `#`, the code on its own line, then comment lines. Parsing rules used by Untapped and safe to copy: split on newlines, trim, ignore lines starting with `#` when looking for the code, take the first remaining line matching `^[A-Za-z0-9+/]+={0,2}$`; list lines match `^#\s*\(\s*\d+\s*\)\s*(.+?)\s*$` and resolve by display name (prefer the collectible card when a name is shared).

## 5. Collection import

### 5.1 Verdict

- **Snap-ID-only sync is not possible.** No tested site returns a player's collection for a Snap ID, profile URL or share link without a login. Every site obtains the collection either by having the player sign in to the game account through the site, or from a Windows tracker reading local files.
- **On macOS there is no local game file to read.** The Steam build is Windows only (measured: `https://store.steampowered.com/api/appdetails?appids=1997040` returns `"platforms":{"windows":true,"mac":false,"linux":false}`).
- This machine: **no**. `~/Library/Application Support/Steam` exists but has no SNAP install; no `CollectionState.json` under `~/Library` (searched 7 levels deep) and none in Spotlight; no Second Dinner folder; no matching app in `/Applications` or `~/Library/Containers`. Only names were listed, nothing was opened.

### 5.2 What each site does (a, b)

| Site | Public by ID? | How the collection gets there | Measured |
|---|---|---|---|
| Untapped | No | Windows tracker, or "mobile sync": the player signs in to Marvel Snap with Google or Apple from Untapped's page and pastes back the redirect URL, which expires in 45 seconds. Needs an Untapped account. | Site JS reads `/account/collections/{player_id}` with cookies. `GET https://api.snap.untapped.gg/api/v1/account/collections/0` returns **403** `{"detail":"Authentication credentials were not provided."}`. Other calls in the JS: `account/snap-sync/login-with-state`, `account/snap-sync/update-collection/{id}` (POST), `account/snap-sync/session/`. Public profile route exists as `/profile/{userId}/{playerId}`; whether it shows cards was not tested (no player id was used). Help page: `https://help.hearthsim.net/en/articles/10175073-how-to-sync-my-marvel-snap-collection-on-mobile`. |
| Marvel Snap Zone / marvelsnap.pro | No | Collection page offers manual clicking (stored in the browser), "Import from MARVEL SNAP" linking to `/pro/snapconnect.php`, and "Sync with Marvel Snap Tracker" linking to `marvelsnap.pro/settings/` (Windows tracker plus account). | `https://marvelsnapzone.com/collection/` 200. `/pro/` is disallowed in robots.txt and was not opened. `https://marvelsnap.pro/collection/` 200, empty shell without login. Leaderboard profiles show stats and decks of tracker users, not collections (their 2023 announcement). |
| snap.fan | No | "Auto sync": configure a Google or Apple game login under account settings; then profile, decks and collection sync on demand. | Described at `https://snap.fan/news/snapfan-auto-sync-character-mastery-update/` (2025-02-20, 200). Settings page needs an account; not opened. |

All three "no PC" routes work by the site receiving a game login token. Snap Forge must not copy that flow: it would handle the owner's game credentials. None of the sites documents a download or export button for the synced collection; the only export seen is the logged-in JSON call above.

### 5.3 Local state files (c)

- Windows path, from `github.com/snaptools2023/snapscripts` (pushed 2026-07-06): `%USERPROFILE%\AppData\LocalLow\Second Dinner\SNAP\Standalone\States\nvprod\CollectionState.json`. PCGamingWiki lists the folder `%USERPROFILE%\AppData\LocalLow\Second Dinner\SNAP\` (via search result, page not fetched).
- Shape as read by those scripts: `ServerState.Cards` is an array with one object per owned card copy, each with `CardDefId` and `RarityDefId` (a card owned in several variants appears several times); `ServerState.CardDefStats.Stats` is an object keyed by CardDefId with `Boosters`; the player's decks are in the same file. Owned set: the distinct `ServerState.Cards[].CardDefId`. The scripts note that the file refreshes only after a match or an app restart.
- **Not verified**: no real file was available, so the shape is taken from script source, and the script that reads cards carries a 2023 header. Also not verified: the other files in that folder (`ProfileState.json` and others), and where the Snap ID or account id sits. Reading one real Windows file would settle all three.
- macOS: no such path exists, because there is no macOS desktop client on Steam. Whether the iOS app can be installed on an Apple silicon Mac, and where it would keep its data, was not checked.

### 5.4 Recommended routes (d)

Neither route needs credentials inside Snap Forge.

**Primary: one import box (file upload or paste) that detects the format.**

1. `CollectionState.json` from a Windows PC: read distinct `ServerState.Cards[].CardDefId`. Fully automatic, but only if the owner has or borrows a Windows install of the game. Not available on the owner's Mac.
2. A pasted or uploaded list: one card per line, either CardDefId or display name, also accepting `# (cost) Name` lines and CSV with the id in the first column. Resolve names through the card index and report every line that did not match.
3. Deck codes: pasting any deck code (section 4) marks its 12 cards as owned. On a phone the owner copies each of their decks in the game and pastes them. Credential-free and works on macOS today; it only covers cards that are in a deck.
4. Optional, **not verified**: a JSON saved by the owner from a tracker site they chose to sync with (for Untapped, the response of `/account/collections/{player_id}` seen in the browser's network tab while logged in). The shape is unknown until the owner captures one; add a parser only then.

**Fallback: manual marking in the UI**, with bulk toggles per series ("own all of Series 1", "Series 2", "Series 3", Starter) and single-card toggles for Series 4 and 5. Series comes from the card data, so this is cheap, and it is the realistic path for a macOS and mobile player.

Store the result as a set of CardDefIds with the import date and source, and always intersect with the released collectible set.

## 6. Sync recipe

1. `GET https://snapjson.untapped.gg/v2/latest/en/cards.json`; record the build from the final URL. Then `locations.json`.
2. Classify with the rule in 1.1 using the current time. Keep upcoming and non-collectible rows in the database, flagged, so pasted codes and card text that mention tokens still resolve.
3. Optional enrichment: `GET https://api.dotgg.gg/cgfw/getcards?game=marvelsnap` for `abilities`, `is_Token` and `changes`, joined on id. If Untapped fails, build the card table from this file alone (rule in 1.2).
4. Images: one request per card to the 512 URL, at least 1 second apart, skipping files already on disk.
5. Strip or convert game markup in `description` before display (`<b>`, `<i>`, `<color>`, `<sprite>`, `\n`).
6. Send `User-Agent: SnapForge/0.1` and nothing else that identifies the owner.

## 7. Open questions

1. Which format the game client copies today, and whether it still accepts long codes. One copy and one paste in the game answers it.
2. A real short code string from a live deck page, to confirm there is no extra prefix or suffix inside the base64 beyond the comma list.
3. The real 2026 shape of `CollectionState.json` and the location of the Snap ID in the state files (needs one Windows file).
4. Whether Untapped's logged-in collection JSON is a practical export, and its shape.
5. Whether the owner is comfortable with using `marvelsnapzone.com/getinfo/` at all given its robots.txt; nothing in the recommended path depends on it.
6. Untapped's `artists[].type` and `<sprite=N>` meanings; and whether `render/crop` art is wanted for small thumbnails.
