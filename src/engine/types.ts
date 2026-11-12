export type CardClass = 'released' | 'upcoming' | 'token';
export type FormatId = string;            // 'ranked', 'sanctum-showdown', ...
export type AxisId = string;              // 'destroy', 'discard', 'move', ... (mechanics §3)
export type TechRole = string;            // 'ongoing-removal', 'power-reset', ... (spec §8.2)
export type Provenance = 'measured' | 'derived' | 'heuristic';

export interface Card {
  defId: string;                 // Untapped defId, primary key
  name: string;
  cost: number;
  power: number;
  text: string;                  // markup removed; '' for no-ability cards
  rawText: string;               // source description
  hasAbility: boolean;
  isSkill: boolean;
  isSeasonPass: boolean;
  series: number;                // Untapped series number (data §1.1)
  seriesLabel: string;           // 'Series 3', 'Series 5', 'Starter', ...
  releaseAt: number | null;      // epoch ms of first availability; null = always available
  cardClass: CardClass;          // computed from the clock at load
  tokens: string[];              // defIds this card creates (Card_Token)
  attributes: Record<string, number>; // attributes.data numbers
}

export interface Effect {
  kind: string;                  // mechanics §2 effect kinds
  target: string;                // mechanics §2 targets
  magnitude: number | null;
  selectors: string[];
}
export interface Clause {
  trigger: string;               // 'on_reveal', 'ongoing', 'activate', 'end_of_turn', 'static', ...
  effects: Effect[];
  conditions: string[];
  scaling: string[];
  notes: string[];
  text: string;                  // the sentence(s) this clause came from
  source: 'parser' | 'override';
  complete: boolean;             // every token consumed
}

export interface CardFeatures {
  defId: string;
  clauses: Clause[];
  unparsed: string[];
  traits: string[];
  axes: Record<AxisId, { e: number; p: number; heuristic: boolean }>; // sparse, strengths in [0,1]
  techRoles: TechRole[];
  drawback: boolean;
  restriction: string | null;    // play restriction in words, or null
  model: { extraSeen: number; extraEnergy: number; selfDiscount: number; deckDilution: number };
  quality: number;               // 0..100, heuristic
  qualityParts: { stat: number; text: number; measured: number };
}

export interface EdgeReason { rule: string; kind: 'synergy' | 'anti'; label: string; detail: string; value: number; heuristic: boolean }
export interface CardEdge { a: string; b: string; synergy: number; anti: number; score: number; strong: boolean; sameLocation: boolean; reasons: EdgeReason[] }

export interface FormatDef {
  id: FormatId; name: string; verified: boolean; constructed: boolean;
  banned: string[];              // defIds
  listDate: string | null; sourceUrl: string | null; stale: boolean; note: string;
}

export interface PlanDef {
  id: string; name: string;
  enablerTraits: string[]; payoffTraits: string[];
  minEnablers: number; minPayoffs: number;
  keyTurn: number;               // turn the plan comes online
  takesLocations: string;        // template with {enablers} {payoffs}
  foldsTo: TechRole[];
  payoffWeight: number;          // heuristic
}

export interface MetaInfo {
  source: string; periodId: number | null; periodLabel: string | null; periodStart: string | null;
  fetchedAt: string; lists: number; clusters: number; games: number;
  baselineWinRate: number; minGamesPerList: number;
}
export interface MetaList { key: string; cards: string[]; archetypeId: number | null; games: number; wins: number; cluster: number }
export interface MetaArchetype { id: number; name: string; games: number; wins: number; share: number; topCards: string[]; sample: string[]; planId: string | null }
export interface MetaCardStat { lists: number; listShare: number; clusterShare: number; games: number; winDelta: number | null }
export interface MetaPairStat { lists: number; clusters: number }
export interface MetaIndex {
  info(): MetaInfo | null;
  lists(): readonly MetaList[];
  listsWith(defId: string): readonly number[];      // indexes into lists()
  cardStat(defId: string): MetaCardStat | undefined;
  pair(a: string, b: string): MetaPairStat;          // zeros when unseen
  archetypes(): readonly MetaArchetype[];
}

export interface CardDb {
  now: number;                                       // epoch ms the classes were computed for
  get(defId: string): Card | undefined;
  byName(name: string): Card | undefined;            // case/diacritic/apostrophe-insensitive; prefers released
  released(): readonly Card[];
  all(): readonly Card[];
  features(defId: string): CardFeatures | undefined;
  edges(defId: string): readonly CardEdge[];
  edge(a: string, b: string): CardEdge | undefined;
  formats(): readonly FormatDef[];
  plans(): readonly PlanDef[];
  meta(): MetaIndex;
}

export interface DeckCard { defId: string; locked: boolean }
export interface Deck {
  id: string | null; name: string;
  format: FormatId;
  cards: DeckCard[];
  themes: AxisId[];
  buildMode: 'brew' | 'tuned';
}

export interface Violation { code: string; severity: 'error' | 'warning' | 'info'; message: string; cardIds: string[]; heuristic: boolean }

export interface EnergyReport {
  expectedSpent: number;          // of 21
  pNoPlay: number[];              // index 1..6
  likelyPlays: string[][];        // index 1..6, defIds
  curve: number[];                // cards at cost 0..7 (7 = 7+)
  avgCost: number;
}

export interface PlanMatch {
  planId: string; name: string; strength: number;   // 0..1
  enablers: string[]; payoffs: string[];
  assembly: number; keyTurn: number;
  singleCardDependence: string | null;
  takesLocations: string;
  foldsTo: { role: TechRole; cards: string[]; fieldShare: number | null }[];
}
export interface PlanReport { primary: PlanMatch | null; secondary: PlanMatch | null; all: PlanMatch[]; offPlan: string[] }

export interface ScorePart { key: 'synergy' | 'quality' | 'plan' | 'energy' | 'meta' | 'novelty' | 'tech'; points: number; max: number }
export interface CardScore {
  defId: string; score: number;   // 0..100 integer
  parts: ScorePart[]; reasons: string[];
  partners: { defId: string; score: number; reason: string }[];
  gate: { code: string; message: string } | null;
}

export interface Fix { text: string; filter: { axis?: AxisId; techRole?: TechRole; maxCost?: number; minCost?: number } | null }
export interface SubScore { key: string; label: string; weight: number; value: number; fixes: Fix[]; provenance: Provenance }
export interface DeckRating { rating: number; legal: boolean; complete: boolean; subscores: SubScore[]; violations: Violation[] }

export interface NearList { key: string; shared: number; archetype: string | null; games: number; cards: string[] }
export interface PairEvidence { a: string; b: string; strength: number; observed: number; expected: number; unexplored: number; liftSmoothed: number; warning: string | null }
export interface NoveltyReport {
  novelty: number;                // 0..100
  band: 'meta' | 'variant' | 'off-meta' | 'brew' | 'unknown';   // 'unknown' (engine review): no meta lists or fewer than 12 known cards; novelty is then 0
  parts: { listDistance: number; connectedRarity: number; packageNovelty: number };
  nearest: NearList[];            // up to 3
  rareCards: { defId: string; listShare: number; connected: boolean; isNew: boolean }[];
  pairs: PairEvidence[];
  corpus: MetaInfo | null;
  claimsWithheld: string | null;  // why "unexplored" is not claimed, when the corpus is thin
}
export interface Gem { cards: string[]; gem: number; strength: number; unexplored: number; reason: string; observed: number; expected: number; warning: string | null }

export interface FloorCheck { key: string; label: string; value: number; threshold: number; passed: boolean; detail: string; provenance: Provenance }
export interface FloorReport { passed: boolean; checks: FloorCheck[] }

export interface Line { kind: 'turn' | 'assembly' | 'sequence' | 'location' | 'package' | 'one-away' | 'field' | 'tech' | 'risk'; text: string; cardIds: string[]; reason: string; probability: number | null; provenance: Provenance }
export interface LineReport { turns: Line[]; assembly: Line[]; sequencing: Line[]; locations: Line[]; packages: Line[]; oneAway: Line[]; field: Line[]; tech: Line[]; risks: Line[] }

export interface Prompts {
  maxPlayRate: number | null;     // list share ceiling, e.g. 0.05
  techExempt: boolean;
  maxShared: number | null;       // max cards shared with any known list
  wildcards: number;              // slots filled by gem score
  maxSeries: number | null;
  avoid: string[];                // defIds
  surprise: boolean;
}
export interface BuildOptions { mode: 'brew' | 'tuned'; seed: number; owned: Record<string, true> | null; prompts: Prompts; count: number }
export interface PickReason { defId: string; interaction: string; unusual: string; replaces: string; risk: string }
export interface BrewResult { deck: Deck; rating: number; novelty: NoveltyReport; floor: FloorReport; plan: PlanMatch | null; why: string; picks: PickReason[] }
export interface BuildOutcome { results: BrewResult[]; refused: string | null }
export interface SwapProposal { out: string; in: string; reason: string; ratingBefore: number; ratingAfter: number; noveltyBefore: number; noveltyAfter: number }

export interface EngineContext { db: CardDb; owned: Record<string, true> | null }
