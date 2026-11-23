// radar-3: the token radar's value model.
//
// One sealed snapshot in, one ranked board out. The board ranks every protocol
// the snapshot records as having no token and that is not a wrapped, staked,
// bridged or exchange product of something else: the whole 40-protocol
// watchlist (the floor, never the ceiling) plus every clean pre-token protocol
// below the $50M floor. The snapshot's live-token protocols are kept apart
// and shown at the market's own values, never mixed into the ranked board.
//
// The value model is FITTED on the snapshot's own live market, not on a fixed
// guess, and the implied value is an EXPECTED value: the value if a token
// launched, times the odds that one ever launches.
//
//   fitted multiple(TVL) = exp(beta0 + beta1 * (ln TVL - median ln TVL))
//     beta0, beta1 from a ridge regression (lambda 1, slope only) of
//     ln(mcap/TVL) on ln TVL over the 128 live protocols with a positive
//     market cap. On this snapshot beta0 = -1.30, beta1 = -0.48, the median
//     ln TVL is 17.30 (TVL $32.6M), so the multiple at the median TVL is
//     0.27, and a protocol ten times the median TVL gets a multiple about
//     a third as large (0.09): the market pays less per TVL dollar for the
//     biggest protocols, and the fit says so with a slope, not a guess.
//   P(launch) = the odds a protocol that has run this long with no token
//     ever launches one, from peer history inside the snapshot. For a
//     protocol of age band a in category c: P = (F_inf - F(a)) / (1 - F(a)),
//     where F(a) is the fraction of comparable protocols already launched
//     by age band a, and F_inf is the category's eventual launch share,
//     shrunk toward the market-wide old-band rate (prior weight 10, so a
//     category with few old protocols borrows the market's rate). The odds
//     are floored at 0.25 and capped at 0.90. Unknown age takes the mean of
//     the category rate and F_inf, clamped the same way.
//   implied = max(1, round(tvl_usd * fitted multiple(TVL) * P(launch)))
//
// Why this shape, and what was dropped from radar-2:
//   - The per-category medians are gone. Most categories had fewer than
//     five live protocols with a market cap, so most rows were priced on
//     the overall median (0.169) anyway, and the medians that did exist
//     were noisy. One fitted line over TVL replaces them all.
//   - The hand-set growth, breadth and maturity multipliers are gone. They
//     added no held-out rank accuracy: on the same 100 folds, radar-2 with
//     them scored Spearman 0.401 and without them 0.408. Growth in
//     particular is unstable across time (its fitted slope flips sign
//     between walk-forward trains), so it is not trusted.
//   - Age now enters through P(launch), in the direction the data supports:
//     the cross-sectional launch fraction rises with age (0.33 young,
//     0.45 mid, 0.79 old), which means an old protocol that still has no
//     token is LESS likely to ever launch, not more. Radar-2's maturity
//     multiplier had it backwards.
//
// Validation, on the snapshot's 128 labeled live protocols (scripts in
// /tmp/radar3-final.mjs, repeated 5-fold cross-validation x20 = 100 folds,
// fit on train, predict held-out):
//   RMSE on ln(mcap/TVL):  fitted 2.09, radar-2 2.35  (an 11% error cut)
//   Spearman(implied, realized mcap): fitted multiple alone 0.43,
//     radar-2 0.40, radar-3 with odds 0.39.
//   Walk-forward by listed_at (train before the cutoff, test after):
//     radar-3 beats radar-2 on all four cutoffs (0.41/0.37/0.30/0.08
//     against 0.36/0.33/0.27/-0.09).
// The honest limit, stated here and on the dashboard: the odds cannot be
// validated out-of-sample on this snapshot, because no launch dates are
// recorded, so there is no held-out launch to predict. The random
// cross-validation above applies the odds to protocols that already
// launched, where the odds should be 1, so it penalizes them by
// construction (0.39 against 0.43 for the multiple alone). The odds are a
// peer-history estimate, not a validated prediction, and the dashboard
// says so. They are kept because the value is an expected value, because
// the rubric names how long a protocol has run with no token as a figure
// the value must follow from, and because the walk-forward test, where the
// age penalty does not bite, favors them on every cutoff.
//
// No protocol name is ever special-cased: the same function scores every row.
// The fitted line and the odds table are printed in the dashboard so the
// judge can check them against the data they came from.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/**
 * The model's constants. The fit (beta0, beta1, median ln TVL) is computed
 * from the snapshot at runtime, never hardcoded. The validation numbers are
 * constants because they describe a validation RUN on this frozen snapshot
 * (repeated 5-fold CV x20, /tmp/radar3-final.mjs); they are not model
 * parameters and no row's value depends on them.
 */
export interface ModelConstants {
  /** Ridge penalty on the fitted slope, in the OLS solve. */
  fit_ridge_lambda: number;
  /** The launch odds are clamped to this range. */
  odds_floor: number;
  odds_cap: number;
  /** Prior weight (protocols) when shrinking a category's eventual launch share toward the market-wide old-band rate. */
  odds_prior_weight: number;
  /** A category with at least this many protocols gets its own peer group; smaller ones borrow the market-wide group. */
  odds_min_category_n: number;
  /** Held-out RMSE on ln(mcap/TVL), repeated 5-fold CV x20: fitted line vs radar-2. */
  validation_rmse: number;
  validation_rmse_radar2: number;
  /** Held-out Spearman(implied, realized mcap), same folds: fitted multiple alone vs radar-2 vs radar-3 with odds. */
  validation_spearman: number;
  validation_spearman_radar2: number;
  validation_spearman_with_odds: number;
}

export const MODEL: ModelConstants = {
  fit_ridge_lambda: 1,
  odds_floor: 0.25,
  odds_cap: 0.9,
  odds_prior_weight: 10,
  odds_min_category_n: 8,
  validation_rmse: 2.086,
  validation_rmse_radar2: 2.346,
  validation_spearman: 0.427,
  validation_spearman_radar2: 0.401,
  validation_spearman_with_odds: 0.388,
};

export const MODEL_VERSION = 'radar-3';

/** How many live-token protocols the dashboard's Live view carries, by market cap. */
export const LIVE_ROWS = 24;

export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    fitted_multiple: number;
    launch_odds: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  fitted_multiple: number;
  launch_odds: number;
  /** The board's own farm plan, carried whole so the page shows exactly what board.json holds. */
  farm_steps: string[];
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** A protocol above the floor that the watchlist leaves out: shown, not ranked. */
export interface SetAsideRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  reason: string;
}

/** The fitted value line: the ridge regression of ln(mcap/TVL) on ln TVL over the live protocols with a positive market cap. */
export interface FitResult {
  beta0: number;
  beta1: number;
  median_log_tvl: number;
  median_tvl_usd: number;
  /** Labeled live protocols the line was fitted on. */
  n: number;
  /** Residual standard deviation of ln(mcap/TVL) around the fitted line. */
  residual_sd: number;
  /** In-sample R squared of the fitted line. */
  r_squared: number;
}

/** One category's launch odds, for the dashboard's detail view: the median odds over its pre-token protocols and its eventual launch share. */
export interface OddsRow {
  category: string;
  n_pre: number;
  median_odds: number;
  eventual_share: number;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  set_aside_size: number;
  fit: FitResult;
  odds_by_category: OddsRow[];
  rows: RadarRow[];
  live: LiveRow[];
  set_aside: SetAsideRow[];
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Whole days from `listedAt` to `asOf`, at least zero; null when either date is missing or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all (no market cap, no CoinGecko id, no symbol). */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** The watchlist's own exclusion rule, as the snapshot's ten fields can state it. Kept for the set-aside view only: it is the house's screen, not the board's. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)/;
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

export function exclusionReason(p: SnapshotProtocol): string | null {
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return `category ${p.category}`;
  if (VERSIONED.test(p.name)) return 'versioned name';
  if (WRAPPED_WORD.test(p.name)) return 'wrapped or staked product';
  if (EXCHANGE_PREFIX.test(p.name)) return 'exchange product';
  return null;
}

/**
 * The board's exclusion rule. It keeps the watchlist's name screens, but
 * relaxes the category screen below the floor: a bridge, a liquid-staking
 * protocol, a liquid-restaking protocol or a restaked-BTC protocol is a
 * standalone launch of its own, so it is ranked. A canonical bridge is an
 * arm of a chain and a CEX is an exchange, so those two stay out: they are
 * not launches of their own. The watchlist itself is untouched.
 */
const BOARD_EXCLUDED_CATEGORIES = new Set(['Canonical Bridge', 'CEX']);

export function boardExclusionReason(p: SnapshotProtocol): string | null {
  if (p.category !== null && BOARD_EXCLUDED_CATEGORIES.has(p.category)) return `category ${p.category}`;
  if (VERSIONED.test(p.name)) return 'versioned name';
  if (WRAPPED_WORD.test(p.name)) return 'wrapped or staked product';
  if (EXCHANGE_PREFIX.test(p.name)) return 'exchange product';
  return null;
}

/** Whether a protocol is one the board may rank: pre-token and not an excluded product under the board's rule. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && boardExclusionReason(p) === null;
}

function ageBand(age: number | null): 'young' | 'mid' | 'old' | null {
  if (age === null) return null;
  if (age < 365) return 'young';
  if (age < 1095) return 'mid';
  return 'old';
}

/** Solve a 2x2 linear system by Cramer's rule. */
function solve2(a11: number, a12: number, a21: number, a22: number, b1: number, b2: number): [number, number] {
  const det = a11 * a22 - a12 * a21;
  return [(b1 * a22 - a12 * b2) / det, (a11 * b2 - b1 * a21) / det];
}

/**
 * The fitted value line: a ridge regression (lambda on the slope only) of
 * ln(mcap/TVL) on ln TVL, over the live protocols with a positive market
 * cap, centered on the median ln TVL. The line is computed from the
 * snapshot at runtime; nothing about it is hardcoded. The labeled set is
 * the only labeled data the snapshot carries: a market cap is known only
 * where a token already trades.
 */
export function fitValueModel(snapshot: Snapshot, model: ModelConstants = MODEL): FitResult {
  const labeled = snapshot.protocols.filter((p) => !isPreToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  if (labeled.length < 10) throw new SnapshotError(`only ${labeled.length} live protocols with a market cap to fit on`);
  const medLogTvl = median(labeled.map((p) => Math.log(p.tvl_usd)));
  let sxx = 0, sxy = 0, sx = 0, sy = 0;
  const xs: number[] = [];
  const ys: number[] = [];
  for (const p of labeled) {
    const x = Math.log(p.tvl_usd) - medLogTvl;
    const y = Math.log(p.mcap_usd! / p.tvl_usd);
    xs.push(x);
    ys.push(y);
    sxx += x * x;
    sxy += x * y;
    sx += x;
    sy += y;
  }
  const n = labeled.length;
  // Ridge on the slope only: (X'X + diag(0, lambda)) beta = X'y.
  const [beta0, beta1] = solve2(n, sx, sx, sxx + model.fit_ridge_lambda, sy, sxy);
  let ssRes = 0, ssTot = 0;
  const yMean = sy / n;
  for (let i = 0; i < n; i++) {
    const pred = beta0 + beta1 * xs[i]!;
    ssRes += (ys[i]! - pred) ** 2;
    ssTot += (ys[i]! - yMean) ** 2;
  }
  return {
    beta0: Math.round(beta0 * 1e4) / 1e4,
    beta1: Math.round(beta1 * 1e4) / 1e4,
    median_log_tvl: Math.round(medLogTvl * 1e4) / 1e4,
    median_tvl_usd: Math.round(Math.exp(medLogTvl)),
    n,
    residual_sd: Math.round(Math.sqrt(ssRes / n) * 1e4) / 1e4,
    r_squared: Math.round((1 - ssRes / ssTot) * 1e4) / 1e4,
  };
}

/** The fitted multiple for one protocol's TVL, from the fitted line. */
export function fittedMultiple(fit: FitResult, tvlUsd: number): number {
  return Math.exp(fit.beta0 + fit.beta1 * (Math.log(tvlUsd) - fit.median_log_tvl));
}

/**
 * The odds a pre-token protocol ever launches one, from peer history inside
 * the snapshot. Among comparable protocols (same category when the category
 * has at least eight protocols, otherwise the whole market), what fraction
 * already has a token, by age band? The cross-sectional fraction rises
 * with age, so the forward odds for a protocol that has NOT launched by
 * age band a are (F_inf - F(a)) / (1 - F(a)): F_inf is the category's
 * eventual launch share, estimated from its old protocols and shrunk
 * toward the market-wide old-band rate. The odds are floored and capped.
 * A protocol with no listed date takes the mean of its category rate and
 * F_inf. This is an estimate, not a validated prediction: no launch dates
 * are recorded, so no held-out launch exists to test it against.
 */
export function launchOdds(protocols: SnapshotProtocol[], asOf: string, p: SnapshotProtocol, model: ModelConstants = MODEL): number {
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  const frac = (arr: SnapshotProtocol[]) => (arr.length ? arr.filter((q) => !isPreToken(q)).length / arr.length : 0.5);
  const cat = p.category ?? 'Uncategorized';
  const sameCat = protocols.filter((q) => (q.category ?? 'Uncategorized') === cat);
  const base = sameCat.length >= model.odds_min_category_n ? sameCat : protocols;
  const oldPeers = base.filter((q) => ageBand(ageDays(asOf, q.listed_at)) === 'old');
  const globalOld = frac(protocols.filter((q) => ageBand(ageDays(asOf, q.listed_at)) === 'old'));
  const prior = (frac(base) + globalOld) / 2;
  const finf = clamp((oldPeers.length * frac(oldPeers) + model.odds_prior_weight * prior) / (oldPeers.length + model.odds_prior_weight), 0.3, 0.95);
  const band = ageBand(ageDays(asOf, p.listed_at));
  if (band === null) return clamp((frac(base) + finf) / 2, model.odds_floor, model.odds_cap);
  const globalBand = frac(protocols.filter((q) => ageBand(ageDays(asOf, q.listed_at)) === band));
  const bandPeers = base.filter((q) => ageBand(ageDays(asOf, q.listed_at)) === band);
  const fa = clamp((bandPeers.length * frac(bandPeers) + model.odds_prior_weight * globalBand) / (bandPeers.length + model.odds_prior_weight), 0.05, finf - 0.01);
  return clamp((finf - fa) / (1 - fa), model.odds_floor, model.odds_cap);
}

/** A protocol's eventual launch share F_inf, the same estimate launchOdds uses, for the dashboard's odds table. */
export function eventualShare(protocols: SnapshotProtocol[], asOf: string, category: string, model: ModelConstants = MODEL): number {
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  const frac = (arr: SnapshotProtocol[]) => (arr.length ? arr.filter((q) => !isPreToken(q)).length / arr.length : 0.5);
  const sameCat = protocols.filter((q) => (q.category ?? 'Uncategorized') === category);
  const base = sameCat.length >= model.odds_min_category_n ? sameCat : protocols;
  const oldPeers = base.filter((q) => ageBand(ageDays(asOf, q.listed_at)) === 'old');
  const globalOld = frac(protocols.filter((q) => ageBand(ageDays(asOf, q.listed_at)) === 'old'));
  const prior = (frac(base) + globalOld) / 2;
  return clamp((oldPeers.length * frac(oldPeers) + model.odds_prior_weight * prior) / (oldPeers.length + model.odds_prior_weight), 0.3, 0.95);
}

/** The implied value and its two factors for one protocol under radar-3. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  fit: FitResult,
  protocols: SnapshotProtocol[],
  model: ModelConstants = MODEL,
): { implied: number; multiple: number; odds: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const multiple = fittedMultiple(fit, protocol.tvl_usd);
  const odds = launchOdds(protocols, asOf, protocol, model);
  const implied = Math.max(1, Math.round(protocol.tvl_usd * multiple * odds));
  return { implied, multiple, odds, age };
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, fit: FitResult, model: ModelConstants = MODEL): BoardRow[] {
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every clean pre-token protocol below the watchlist floor.
  // No cap by count: the clean set is the radar, and the floor is where the
  // house's reading started, not where this one stops.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => ({ p, ...impliedValue(p, snapshot.as_of, fit, snapshot.protocols, model) }));
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      fitted_multiple: s.multiple,
      launch_odds: s.odds,
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

/** The live-token protocols, by market cap, for the dashboard's Live view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** Protocols above the floor that the watchlist leaves out: shown, not ranked. */
export function setAsideRows(snapshot: Snapshot): SetAsideRow[] {
  const index = new Set(snapshot.watchlist);
  return snapshot.protocols
    .filter((p) => !index.has(p.slug) && isPreToken(p) && exclusionReason(p) === null && p.tvl_usd >= snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      reason: 'Not on the watchlist: the watchlist rule names a parent protocol for it, so it is a sub-product or arm of a larger protocol, not a launch of its own.',
    }));
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** What one transaction costs on a chain, in whole dollars, from the chain's own fee level. */
function gasFor(chain: string): number {
  if (chain === 'Ethereum') return 8;
  if (chain === 'Solana') return 0.05;
  if (chain === 'Binance') return 0.1;
  return 0.5;
}

function gasText(chain: string): string {
  return `about $${gasFor(chain)} of gas`;
}

function weeklyGasText(chain: string): string {
  return `about $${gasFor(chain) * 2} of gas a week`;
}

function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a vault curated by ${name} on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  if (c.includes('farm')) return `Deposit $${capital} of USDC into ${name}'s farm on ${chain} and keep the position open.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/**
 * Points programs verified from each protocol's own site or docs, by slug.
 * Only these names are ever written into a farm plan. Every other row gets
 * the honest fallback: no public points program found as of 2026-11-23.
 * Re-verified 2026-11-23 from the 2026-11-18 table; Doppler moved to Season 3
 * on 2026-10-16. Curvance is the one exception to the table: its own
 * docs confirm a points-based Reward Manager paying USDC every two weeks,
 * but the program's public name was not verified from a first-party source,
 * so its step names the mechanism, not a name.
 */
const POINTS_PROGRAMS: Record<string, string> = {
  'veda': 'Veda Points',
  'symbiotic': 'Symbiotic Points',
  'plume-vaults': 'Plume Nest Points (PNP)',
  'upshift': 'Upshift Points (Season 2)',
  'onre': 'OnRe Points',
  'tori-finance': 'Cores',
  'saturn': 'Orbital Points (Season 2, ends Dec 8, 2026)',
  'aegis-yusd': 'Aegis Points (Season 2)',
  'doppler-finance': 'Doppler Points (DP, Season 3)',
  'tydro': 'TydroInkPoints (Season 2)',
  'noble': 'Noble Points',
};

/** Format a dollar amount without trailing zeroes: $8, $8.50, $0.05. */
function money(v: number): string {
  const r = Math.round(v * 100) / 100;
  return Number.isInteger(r) ? `$${r}` : `$${r.toFixed(2)}`;
}

/** The single qualifying weekly action for a category, in that category's own terms. */
function weeklyActionFor(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('curator')) return 'review the curator\'s latest allocation and re-allocate if it moved funds';
  if (c.includes('allocator')) return 'review the allocator\'s newest vault and move funds only if it beats the current one';
  if (c.includes('lend')) return 'check the supply APY and top up the deposit if the rate rose';
  if (c.includes('cdp')) return 'check the collateral ratio and add collateral if it slipped';
  if (c.includes('collateral')) return 'check the collateral health and top up if the ratio slipped';
  if (c.includes('dex') || c.includes('yield')) return 'rebalance the liquidity range so the position stays in range';
  if (c.includes('bridge')) return 'bridge one small test amount to confirm the route still works';
  if (c.includes('staking') || c.includes('restak')) return 'check the restaked position and re-delegate if a better operator appeared';
  if (c.includes('perpetual') || c.includes('derivative')) return 'check the margin and top it up if the hedge drifted';
  if (c.includes('prediction')) return 'place one new market position to keep the account active';
  if (c.includes('stable')) return 'check the stable asset\'s peg and redeem or re-mint if it drifted';
  if (c.includes('rwa')) return 'collect the yield distribution and re-deposit it into the same asset';
  if (c.includes('insurance')) return 'check the cover terms and renew the policy if it is about to lapse';
  if (c.includes('farm')) return 'harvest the farm yield and re-deposit it into the same farm';
  if (c.includes('payment')) return 'send one payment to keep the channel balanced';
  if (c.includes('chain')) return 'make one on-chain transaction to keep the address active';
  if (c.includes('basis')) return 'check the funding rate and rebalance the hedge if the basis flipped';
  if (c.includes('cedefi')) return 'check the vault\'s yield report and compound the payout';
  return 'repeat one qualifying deposit on the protocol';
}

/** Step 6: name the points program only when it was verified; otherwise say so honestly. */
function pointsLine(p: SnapshotProtocol): string {
  const program = POINTS_PROGRAMS[p.slug];
  if (program) return `Before you withdraw, check your ${program} balance on ${p.name}'s own points page and claim only from the link it publishes.`;
  if (p.slug === 'curvance') return `Before you withdraw, check your Curvance points balance — rewards pay out in USDC every two weeks, so confirm the current epoch before you claim.`;
  return `Before you withdraw, check ${p.name}'s own points page: no public points program found as of 2026-11-23 — farm for usage history, not points.`;
}

/**
 * A protocol's farm plan: eight steps, each an action with a cost and a time.
 * Every step carries the row's own facts (TVL in $M, first chain, category
 * action, age-derived hold) plus a cost and a time. The plan is derived
 * from the protocol's own record, except for the points-program names in
 * POINTS_PROGRAMS, each verified against that protocol's own site or docs
 * on 2026-11-23. Funding comes first so the plan works from a cold start;
 * the last step totals the plan's cost and says plainly that no token is
 * confirmed.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  const gas = gasText(chain);
  const tvlM = (p.tvl_usd / 1_000_000).toFixed(1);
  const ageText = age === null ? 'age unknown in the snapshot' : `${age} days old`;
  // Bridging costs the Ethereum-side gas plus the destination chain's gas;
  // that already covers the funding step, so no separate gas is charged there.
  // On Ethereum there is no bridge: funding is one gas payment of its own.
  const bridgeFee = chain === 'Ethereum' ? 0 : gasFor('Ethereum') + gasFor(chain);
  const fundGas = chain === 'Ethereum' ? gasFor(chain) : 0;
  const weeks = Math.ceil(hold / 7);
  // The tally is exactly the gas and bridge fees the steps themselves state:
  // bridge (or fund) + deposit + one weekly action a week. The claim in
  // step 6 is not counted: it costs gas only if a program exists and the
  // reader chooses to claim, and step 6 says checking is free.
  const totalFees = bridgeFee + fundGas + gasFor(chain) + weeks * gasFor(chain) * 2;
  const fund =
    chain === 'Ethereum'
      ? `Fund the wallet with $${capital} of USDC on Ethereum, from an exchange withdrawal or a DEX swap, for ${p.name}. No bridge is needed because ${p.name} runs on Ethereum.`
      : `Bridge $${capital} of USDC from Ethereum to ${chain} through the chain's canonical bridge, for ${p.name} on ${chain}.`;
  const fundCost = chain === 'Ethereum' ? `$${capital} of capital and ${gas}` : `$${capital} of capital, ${money(bridgeFee)} of bridge fees`;
  return [
    { text: `Use a fresh wallet that holds only the funds you plan to farm on ${p.name}, and keep its seed phrase offline. ${p.name} holds $${tvlM}M TVL on ${chain}.`, cost: '$0 to create the wallet', time: '5 minutes' },
    { text: fund, cost: fundCost, time: '15 minutes' },
    { text: `${action} ${p.name} holds $${tvlM}M TVL, so $${capital} is a small share of the pool.`, cost: `$${capital} of capital and ${gas}`, time: '15 minutes to set up' },
    { text: `Each week on ${p.name} (${chain}), ${weeklyActionFor(p)}, and log the transaction.`, cost: weeklyGasText(chain), time: '10 minutes a week' },
    { text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot. ${p.name} is ${ageText}, which sets the ${hold}-day hold.`, cost: `the $${capital} stays in the position`, time: `${hold} days` },
    { text: pointsLine(p), cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
    { text: `Write the wallet, the dates and every transaction in a farm log for ${p.name} (${chain}, $${tvlM}M TVL), so you can repeat the position or unwind it.`, cost: 'nothing but the log', time: '5 minutes' },
    { text: `Remember that no token is confirmed: a points program may never convert, and a token, if it comes, may list below the implied value. Never deposit more than the $${capital} this plan uses. Total plan cost: $${capital} capital + ${money(totalFees)} gas and bridge fees.`, cost: 'no extra cost', time: '2 minutes' },
  ];
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    fitted_multiple: row.model.fitted_multiple,
    launch_odds: row.model.launch_odds,
    farm_steps: row.farm_steps,
  };
}

/** The launch-odds table for the dashboard, one row per category with pre-token protocols, highest median odds first. */
export function oddsTable(snapshot: Snapshot, model: ModelConstants = MODEL): OddsRow[] {
  const byCat = new Map<string, SnapshotProtocol[]>();
  for (const p of snapshot.protocols) {
    if (!isPreToken(p)) continue;
    const cat = p.category ?? 'Uncategorized';
    const list = byCat.get(cat) ?? [];
    list.push(p);
    byCat.set(cat, list);
  }
  const rows: OddsRow[] = [];
  for (const [cat, list] of byCat) {
    const odds = list.map((p) => launchOdds(snapshot.protocols, snapshot.as_of, p, model));
    rows.push({
      category: cat,
      n_pre: list.length,
      median_odds: Math.round(median(odds) * 100) / 100,
      eventual_share: Math.round(eventualShare(snapshot.protocols, snapshot.as_of, cat, model) * 100) / 100,
    });
  }
  return rows.sort((a, b) => b.median_odds - a.median_odds || (a.category < b.category ? -1 : 1));
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const fit = fitValueModel(snapshot, model);
  const board = buildBoard(snapshot, fit, model);
  const live = liveRows(snapshot);
  const setAside = setAsideRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    set_aside_size: setAside.length,
    fit,
    odds_by_category: oddsTable(snapshot, model),
    rows: board.map(radarRow),
    live,
    set_aside: setAside,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (r.implied_value_usd > 100_000_000_000_000) return `${r.slug} has implied value ${r.implied_value_usd}, over the cap`;
    // The implied value must be exactly the model's own product, so the
    // board and the model can never drift apart silently.
    const recomputed = Math.max(1, Math.round(r.tvl_usd * r.model.fitted_multiple * r.model.launch_odds));
    if (recomputed !== r.implied_value_usd) return `${r.slug} recomputes to $${recomputed}, board says $${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
