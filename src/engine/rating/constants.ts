/**
 * Every weight and threshold of the per-card score (spec §11) and the deck rating (spec §12) in one
 * place. HEURISTIC throughout, except where a line cites a derived or measured source. The rating
 * constants were tuned against the calibration test in tests/engine/rating.test.ts (the 200 most-played
 * fixture lists against 50 seeded random piles); the measured result is written in docs/HANDOVER.md.
 */

/** Sub-score weights of the deck rating (spec §12 table; they sum to 100). */
export const RATING_WEIGHTS = {
  synergy: 18,
  plan: 18,
  energy: 16,
  consistency: 14,
  quality: 14,
  resilience: 10,
  coherence: 10,
} as const;

/** An illegal deck's rating is capped here (spec §12). */
export const ILLEGAL_CAP = 40;
/** At most this many fixes per sub-score (spec §12). */
export const MAX_FIXES = 3;

export const SYNERGY = {
  /** Sum of positive pair scores a complete deck needs for full credit on that term. */
  sumTarget: 6,
  /** Strong pairs of 66 (theory §5: at least 10). */
  strongTarget: 10,
  /** A pair at or above this score counts as a connection when looking for orphans. */
  weakEdge: 0.2,
  /** Term weights inside the sub-score (sum 1). */
  wSum: 0.5,
  wStrong: 0.2,
  wConnected: 0.3,
  /** Points of value (0..1) lost per unit of anti-synergy. */
  antiPenalty: 0.25,
} as const;

export const PLAN = {
  /** Primary strength that earns full credit (the best payoff weight in plans.json is 0.9). */
  fullStrength: 0.85,
  /** Primary strength that earns nothing: a plan just over the 60% assembly threshold at weight 0.8. */
  zeroStrength: 0.4,
  /** Share of plan strength that depends on its enabler x payoff pairs being linked in the network. */
  linkageWeight: 0.25,
  wPrimary: 0.65,
  wPayoffQuality: 0.15,
  wSecondary: 0.2,
  /** Payoff quality range mapped to 0..1. */
  payoffQualityLow: 40,
  payoffQualityHigh: 65,
  /** Credit for the best plan family below the 60% assembly threshold, when there is no primary. */
  noPrimaryCredit: 0.35,
} as const;

export const ENERGY = {
  /** Modelled energy spent: floor and meta median of real lists (theory §1.3, §4.5 C2; measured). */
  floor: 18.0,
  median: 19.3,
  wSpent: 0.7,
  wNoPlay: 0.3,
  /** Mean P(no play) over turns 2-4 that empties the no-play term. */
  noPlayCeiling: 0.25,
  /** Games per energy simulation in the rating and the per-card score (Monte Carlo, seeded). */
  ratingGames: 2000,
  scoreGames: 400,
} as const;

export const CONSISTENCY = {
  /** Assembly odds mapped to 0..1: the plan threshold and the 2 x 2 redundancy target (theory §1.2: 90.9%). */
  low: 0.7,
  high: 0.909,
  singleCardPenalty: 0.25,
  drawBonus: 0.1,
} as const;

export const QUALITY = {
  /** Deck mean quality mapped to 0..1 (theory §4.5 C7: mean 45). */
  meanLow: 45,
  meanHigh: 62,
  /** Single-card floor (theory §4.5 C7: 25, waived with 3+ strong edges). */
  cardFloor: 25,
  waiverStrongEdges: 3,
  tailPenalty: 0.15,
} as const;

export const RESILIENCE = {
  /** How much of the tech exposure is lost from the sub-score. */
  exposureWeight: 0.8,
  /** Credit when a secondary plan does not fold to the role that hits the primary hardest. */
  secondPlanCredit: 0.25,
  /** Value when the meta snapshot is missing (nothing measured to say). */
  noMeta: 0.5,
} as const;

export const COHERENCE = {
  /** Off-plan cards a complete deck can afford (theory §4.5 C8: at most 3). */
  offPlanAllowed: 3,
  offPlanPenalty: 0.1,
  unsupportedPenalty: 0.08,
  unreachablePenalty: 0.15,
} as const;

/** Per-card score part maxima (spec §11 table). */
export const SCORE_MAX = { synergy: 30, quality: 20, plan: 15, energy: 15, meta: 15, novelty: 15, tech: 5 } as const;

export const SCORE = {
  /** Saturation of the synergy part: points = max x (1 - exp(-sum / k)). */
  synergySaturation: 1,
  /** Edges into locked (build-around) cards count this much more. */
  buildAroundBoost: 1.5,
  /** Bonus to the synergy sum for each chosen theme axis the card is on. */
  themeBonus: 0.3,
  /** Plan-value change that earns the full plan part. */
  planDeltaFull: 0.25,
  /** Energy part: change in (spent - 3 x mean no-play T2-4) that moves the part from half to full. */
  energyDeltaFull: 2,
  /** Tuned mode: lists sharing at least (o1 - nearSlack) cards with the deck are its neighbourhood. */
  nearSlack: 2,
  nearLists: 30,
  /** Pseudo-count shrinking the neighbourhood inclusion rate toward the card's overall play rate. */
  inclusionPrior: 5,
  /** Inclusion rate that earns the full meta part. */
  inclusionFull: 0.6,
  /** Brew mode: shares of the novelty part. */
  noveltyRarity: 0.6,
  noveltyUnexplored: 0.4,
  /** Field share answered that earns the full tech part. */
  techShareFull: 0.3,
  /** Partners listed per card. */
  partners: 5,
  partnerMin: 0.1,
} as const;
