/**
 * Every weight and threshold of the per-card score (spec §11) and the deck rating (spec §12) in one
 * place. HEURISTIC throughout, except where a line cites a derived or measured source. The rating
 * constants were tuned against the calibration test in tests/engine/rating.test.ts (the 200 most-played
 * fixture lists against 50 seeded random piles); the measured result is written in docs/HANDOVER.md.
 */

/**
 * Sub-score weights of the deck rating (they sum to 100). Spec §12 had synergy 18, plan 18, energy 16,
 * consistency 14, quality 14, resilience 10, coherence 10. Calibration pass (2026-11-13), measured on the
 * 200 most-played fixture lists against 50 random piles: energy (meta 0.77 / random 0.84) and card quality
 * (0.72 / 0.71) do not tell a real deck from a random one, while synergy (0.87 / 0.22), consistency,
 * resilience and coherence do; weight moved to the sub-scores that measure construction. Energy and quality
 * stay as guards (an unplayable curve or a pile of weak cards still costs points). HEURISTIC.
 */
export const RATING_WEIGHTS = {
  synergy: 28,
  plan: 18,
  energy: 8,
  consistency: 14,
  quality: 6,
  resilience: 12,
  coherence: 14,
} as const;

/** An illegal deck's rating is capped here (spec §12). */
export const ILLEGAL_CAP = 40;
/** At most this many fixes per sub-score (spec §12). */
export const MAX_FIXES = 3;

/**
 * Measured pair evidence (calibration pass): cluster-level co-play lift of a pair in the synced meta
 * corpus. Players putting two cards together far more often than their popularity predicts is MEASURED
 * evidence that the pair works. It counts toward cohesion in the floor and the rating, labelled measured
 * and kept apart from mechanical edges; it never feeds novelty, gems or a brew's justification (brews
 * have low co-play by construction). Thresholds are HEURISTIC.
 */
export const MEASURED = {
  /** Each card must sit in at least this many list clusters (enough data to say anything). */
  minCardClusters: 5,
  /** The pair must be seen together in at least this many clusters. */
  minTogether: 3,
  /** Least lift the one-sided 95% Wilson lower bound of the co-play rate must support (significance). */
  minLift: 1.5,
  /** Share of the rarer card's clusters that also hold the partner: no weight at `shareZero`, full at `shareFull`. */
  shareZero: 0.1,
  shareFull: 0.5,
  /** Below this many clusters the corpus says nothing measured about pairs. */
  minCorpusClusters: 100,
} as const;

/**
 * Cohesion (calibration pass): pair evidence summed over the deck's 66 pairs, each pair counting the larger
 * of its graded mechanical weight (network/edges.ts `gradedWeight`) times `mechFactor`, and its measured
 * weight. HEURISTIC: `mechFactor` discounts heuristic edges by about their held-out strict precision (82.5%
 * strong, 85% partner band), so a proven pair outranks an equally scored but unproven one.
 */
export const COHESION = {
  mechFactor: 0.8,
  /** Cohesion of a complete deck that earns full credit in the rating's synergy sub-score. */
  fullCredit: 14,
  /** Share of that credit mechanical (unproven) pairs can earn on their own; the rest needs measured co-play. An interaction
   * existing (85% strict precision) does not show it is worth a slot; pairs players are measured to play together do. Set so that
   * a brew does not outrank the median meta list by default (calibration pass: brews median 84 vs meta 85 on the real database
   * at 0.5, 90 vs 85 at 0.8). HEURISTIC. */
  mechCap: 0.5,
  /** A pair of at least this weight ties an off-plan card to the deck (rating coherence). */
  tiedWeight: 0.5,
  /** Cohesion bar of a complete deck (floor C6), never below what seeded random piles reach (deck.ts cohesionBar). */
  bar: 6.5,
  /** Rating gate: plan, consistency and resilience get nothing below this share of the bar and full credit at the bar. */
  gateFrom: 0.5,
} as const;

export const SYNERGY = {
  /** A pair at or above this score counts as a connection when looking for orphans. */
  weakEdge: 0.2,
  /** Term weights inside the sub-score (calibration pass: graded cohesion replaced the positive-score sum and the strong-pair count). */
  wCohesion: 0.7,
  wConnected: 0.3,
  /** Points of value (0..1) lost per unit of anti-synergy. */
  antiPenalty: 0.25,
  /** Calibration pass: anti-synergy one card takes part in counts at most this much. Lady Sif discards ONE expensive card,
   * so four expensive cards beside her are one problem, not four (a Lady Sif discard list lost its whole synergy sub-score). */
  antiPerCard: 0.5,
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
  /** Calibration pass: credit for holding the core of a known archetype (scaled by the share of the core held). Holding an
   * archetype's most-played cards is measured evidence of a plan that works, so it can stand in for a weak family match. */
  coreCredit: 0.9,
  /** Calibration pass: credit for a deck with no family and no known core whose cohesion reaches COHESION.fullCredit (a package). */
  packageCredit: 0.6,
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
  /** Assembly odds mapped to 0..1: the plan threshold of spec §10 (calibration pass; was 0.7) and the 2 x 2 redundancy target (theory §1.2: 90.9%). */
  low: 0.6,
  high: 0.909,
  singleCardPenalty: 0.25,
  drawBonus: 0.1,
  /** Calibration pass: consistency credit for an archetype core (scaled by the share of the core held). */
  coreCredit: 0.9,
  /** Calibration pass: consistency credit for a cohesive package with no family (scaled like PLAN.packageCredit). */
  packageCredit: 0.6,
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
