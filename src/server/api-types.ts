/**
 * JSON shapes of the route handlers (plan Task 10). Types only: the UI imports these without
 * pulling in server code.
 */
import type {
  AxisId, Card, CardEdge, CardFeatures, CardScore, Deck, DeckRating, EnergyReport, FloorReport, FormatDef, Gem, LineReport,
  MetaCardStat, MetaInfo, NoveltyReport, PlanReport, Provenance, Violation,
} from '@/engine/types';

/** A card as the client needs it (the raw source description is left out). */
export type CardView = Omit<Card, 'rawText'>;

export interface Settings {
  /** Builds, card browser and gates use only owned cards. */
  ownedOnly: boolean;
  /** Mode new decks are checked against. */
  format: string;
  /** Default search seed: same seed, same brews. */
  seed: number;
  /** Results per brew (1..6). */
  brewCount: number;
}

export interface FormatStatus extends FormatDef { checked: boolean }

export interface StatusResponse {
  /** True when no released card is in the database (the UI sends the owner to the Data page). */
  empty: boolean;
  counts: {
    cards: number; released: number; upcoming: number; tokens: number; features: number; edges: number; strongEdges: number;
    locations: number; decks: number; owned: number; images: number;
  };
  sync: Record<string, { finishedAt: string; info: Record<string, unknown> } | null>;
  meta: MetaInfo | null;
  /** Corpus size for novelty claims; `withheld` says why "unexplored" is not claimed. */
  corpus: { lists: number; clusters: number; archetypes: number; withheld: string | null };
  coverage: Record<string, unknown> | null;
  formats: FormatStatus[];
}

export interface AnalyzeResponse {
  rating: DeckRating;
  novelty: NoveltyReport;
  floor: FloorReport;
  plans: PlanReport;
  energy: EnergyReport;
  lines: LineReport;
  deckScores: CardScore[];
  violations: Violation[];
  legal: boolean;
  /** False for modes whose restrictions are not verified: the UI must not claim a pass for the mode. */
  formatChecked: boolean;
  gemsNear: Gem[];
  cards: Record<string, CardView>;
}

export interface ScoredCard {
  card: CardView;
  score: CardScore;
  /** The card is in the deck (scored leave-one-out; the IN_DECK gate fires only for a second copy). */
  inDeck: boolean;
  /** Share of meta lists holding the card (0 with no meta). Measured. */
  playRate: number;
  axes: CardFeatures['axes'];
  techRoles: string[];
}

export interface CardFilters {
  cost?: number[];             // 7 means 7 or more
  axis?: AxisId;
  side?: 'e' | 'p';            // enabler or payoff side of `axis`; both when absent
  techRole?: string;
  series?: number[];
  owned?: boolean;
  maxPlayRate?: number;
  skills?: boolean;            // false hides skill cards
}

export interface CardsResponse { total: number; page: number; pageSize: number; cards: ScoredCard[] }

export interface CardPartner { defId: string; card: CardView | null; score: number; strong: boolean; reasons: CardEdge['reasons'] }

export interface CardDetail {
  card: CardView;
  features: CardFeatures | null;
  partners: CardPartner[];
  anti: CardPartner[];
  playRate: MetaCardStat | null;
  score: CardScore | null;
  tokens: CardView[];
}

export interface DeckResponse { deck: Deck; updatedAt: string; cards: Record<string, CardView> }

export interface DeckTile {
  id: string; name: string; updatedAt: string; format: string; cards: string[];
  rating: number; legal: boolean; complete: boolean; novelty: number; band: NoveltyReport['band'];
}

export interface ImportResponse {
  deck: Deck;
  unresolved: { line: number; text: string }[];
  violations: Violation[];
  cards: Record<string, CardView>;
}

export interface ExportResponse { text: string; long: string | null; short: string | null }

export interface CollectionSummary {
  owned: number;
  released: number;
  bySeries: { series: number; label: string; owned: number; total: number }[];
  ownedIds: string[];
}

export interface GemView extends Gem { cardViews: CardView[] }
export interface GemsResponse { gems: GemView[]; withheld: string | null; corpus: MetaInfo | null; provenance: Provenance }
