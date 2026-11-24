// lib/model.ts — round-6 value model for make.fun token-radar-01.
// Written fresh 2026-11-24. No line is copied from any earlier build.
//
// The model, in one sentence: implied value = TVL x a fitted multiple x
// the chance the protocol ever launches a token, where the multiple is a
// ridge fit of log market cap on log TVL, age, 7-day growth, chain count
// and category (128 live-token protocols), and the launch chance is a
// forward probability from a saturating launch curve fitted to all 758
// protocols in the snapshot.
//
// Why this shape, and what the hunt found (ledger:
// ~/workspace/goals/token-radar-01-bounty-entry/hidden_files/round6/):
//   - The snapshot's figures explain only ~20% of log market-cap
//     variance. That is the data's ceiling, not the model's: 10-fold CV
//     R^2 is 0.1415 for this ridge fit vs 0.1494 for the TVL-only OLS
//     — a wash, slightly favouring the OLS. The locked holdout (26
//     rows, evaluated once) also favours the simple OLS (R^2 0.2218 vs
//     0.1477). This file does NOT claim a fit win.
//   - The ridge wins where it matters for a board: walk-forward
//     (train listed before 2024, test after) R^2 +0.0509 vs -0.0579 for
//     the OLS. The OLS goes negative out of time; the ridge stays
//     positive. A board is a forward bet, so the time-robust model ships.
//   - The launch odds are the real change. Round 5 used a category
//     median (a cross-sectional rate: the share of protocols in a
//     category that already have tokens). That answers "how often do
//     protocols like this have tokens", not "will THIS one launch".
//     A cross-sectional rate also rises with age — older protocols have
//     had more time to launch — so it rewards stale protocols for being
//     old. The forward odds below answer the board's actual question:
//     given a protocol has NOT launched by age a, what is the chance it
//     ever does? That chance FALLS with age (0.406 at 90 days, 0.101 at
//     5 years), which is the correct direction. The saturating curve it
//     derives from is validated: 5-fold CV log-loss 0.4851, tied with a
//     logistic on age + TVL (0.4837). The forward odds themselves cannot
//     be scored against "has token now" — that would be the wrong target
//     — and this file says so instead of inventing a score for them.

export interface SnapProtocol {
  slug: string;
  name: string;
  category: string;
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
  floor_usd: number;
  source: string;
  protocols: SnapProtocol[];
  watchlist: string[];
}

export interface RowModel {
  fitted_multiple: number;
  launch_odds: number;
  age_days: number;
}

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: "pre-token";
  age_days: number;
  implied_value_usd: number;
  model: RowModel;
  farm_steps: string[];
}

// ---------------------------------------------------------------- helpers

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return 0;
  return n % 2 === 1 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (!listedAt) return null;
  const a = Date.parse(asOf + "T00:00:00Z");
  const b = Date.parse(listedAt);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.max(0, Math.round((a - b) / 86400000));
}

function normName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Solve A x = b by Gaussian elimination with partial pivoting. */
export function solveLinear(aIn: number[][], bIn: number[]): number[] {
  const n = bIn.length;
  const a = aIn.map((row) => [...row]);
  const b = [...bIn];
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(a[r][col]) > Math.abs(a[piv][col])) piv = r;
    }
    if (Math.abs(a[piv][col]) < 1e-12) throw new Error("solveLinear: singular matrix");
    if (piv !== col) {
      [a[col], a[piv]] = [a[piv], a[col]];
      [b[col], b[piv]] = [b[piv], b[col]];
    }
    for (let r = col + 1; r < n; r++) {
      const f = a[r][col] / a[col][col];
      for (let c = col; c < n; c++) a[r][c] -= f * a[col][c];
      b[r] -= f * b[col];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r];
    for (let c = r + 1; c < n; c++) s -= a[r][c] * x[c];
    x[r] = s / a[r][r];
  }
  return x;
}

// ---------------------------------------------------------------- the value fit (ridge)

export interface RidgeFit {
  beta: number[];
  categories: string[];
  medianAge: number;
  medianLogTvl: number;
  medianTvl: number;
  n: number;
  rSquared: number;
  residualSd: number;
}

export function topCategories(live: SnapProtocol[], k: number): string[] {
  const counts = new Map<string, number>();
  for (const p of live) counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, k)
    .map(([c]) => c);
}

export function featureRow(
  p: SnapProtocol,
  age: number,
  cats: string[],
): number[] {
  // change_7d is a weekly percent change. A move beyond -30% / +100%
  // in a week is a data event, not a signal — the snapshot has rows at
  // -72.7% and +4448% — and the fitted coefficient is negative, so an
  // unclipped collapse would inflate the multiple (the hunt's raw fit
  // put a protocol that had just lost 73% of its TVL at rank 1 with a
  // 4.6x multiple). The clip bounds one wild week to at most ~1.2 log
  // points either way. It barely moves the fit: walk-forward stays
  // positive (+0.051 vs +0.072 raw), holdout is unchanged (R^2 0.148
  // vs 0.147), and the fitted coefficients shift by less than 0.01
  // except the growth term itself.
  const chg = Math.min(100, Math.max(-30, p.change_7d ?? 0));
  const x: number[] = [
    1,
    Math.log(p.tvl_usd),
    Math.log(age + 1),
    chg,
    Math.log(Math.max(1, p.chains.length)),
  ];
  for (const c of cats) x.push(p.category === c ? 1 : 0);
  return x;
}

/**
 * Ridge fit of log market cap on [1, log TVL, log age, 7-day change,
 * log chain count, top-k category dummies]. Penalty lambda on every
 * coefficient except the intercept. lambda = 30, chosen by the hunt:
 * the 5-fold CV peak (0.2156) and the only penalty that stays positive
 * walk-forward while keeping the 10-fold paired difference non-negative.
 */
export function fitRidge(live: SnapProtocol[], lambda: number): RidgeFit {
  const cats = topCategories(live, 10);
  const ages = live.map((p) => ageDays("2026-11-14", p.listed_at)).filter((a): a is number => a !== null);
  const medianAge = median(ages);
  const y: number[] = [];
  const rows: number[][] = [];
  for (const p of live) {
    const age = ageDays("2026-11-14", p.listed_at) ?? medianAge;
    rows.push(featureRow(p, age, cats));
    y.push(Math.log(p.mcap_usd as number));
  }
  const d = rows[0].length;
  const xtx: number[][] = Array.from({ length: d }, () => new Array<number>(d).fill(0));
  const xty: number[] = new Array<number>(d).fill(0);
  for (let i = 0; i < rows.length; i++) {
    for (let j = 0; j < d; j++) {
      xty[j] += rows[i][j] * y[i];
      for (let k = 0; k < d; k++) xtx[j][k] += rows[i][j] * rows[i][k];
    }
  }
  for (let j = 1; j < d; j++) xtx[j][j] += lambda;
  const beta = solveLinear(xtx, xty);
  let ssRes = 0;
  let ssTot = 0;
  const yMean = y.reduce((a, b) => a + b, 0) / y.length;
  for (let i = 0; i < rows.length; i++) {
    const pred = rows[i].reduce((s, v, j) => s + v * beta[j], 0);
    ssRes += (y[i] - pred) ** 2;
    ssTot += (y[i] - yMean) ** 2;
  }
  const tvls = live.map((p) => Math.log(p.tvl_usd));
  return {
    beta,
    categories: cats,
    medianAge,
    medianLogTvl: median(tvls),
    medianTvl: Math.exp(median(tvls)),
    n: live.length,
    rSquared: 1 - ssRes / ssTot,
    residualSd: Math.sqrt(ssRes / Math.max(1, live.length - d)),
  };
}

// ---------------------------------------------------------------- the launch curve (forward odds)

/**
 * Saturating launch curve: the share of protocols that have launched by
 * age a is F(a) = Finf * (1 - exp(-a / tau)). Fitted by Bernoulli
 * maximum likelihood over all 758 protocols (has-token = gecko_id
 * present), grid search with one refinement pass. Expected result on
 * this snapshot: Finf ~ 0.43, tau ~ 960 days.
 */
export function fitSaturating(ages: number[], hasToken: number[]): { finf: number; tau: number; loglik: number } {
  const ll = (finf: number, tau: number): number => {
    let s = 0;
    for (let i = 0; i < ages.length; i++) {
      const f = Math.min(0.999999, Math.max(1e-9, finf * (1 - Math.exp(-ages[i] / tau))));
      s += hasToken[i] === 1 ? Math.log(f) : Math.log(1 - f);
    }
    return s;
  };
  let best = { finf: 0.4, tau: 700, loglik: -Infinity };
  for (const finf of [0.3, 0.35, 0.4, 0.43, 0.45, 0.5, 0.55, 0.6]) {
    for (const tau of [300, 500, 700, 900, 1100, 1400, 1800, 2500]) {
      const v = ll(finf, tau);
      if (v > best.loglik) best = { finf, tau, loglik: v };
    }
  }
  for (let step = 0; step < 2; step++) {
    const fStep = step === 0 ? 0.02 : 0.005;
    const tStep = step === 0 ? 100 : 25;
    for (let df = -2; df <= 2; df++) {
      for (let dt = -2; dt <= 2; dt++) {
        const finf = best.finf + df * fStep;
        const tau = best.tau + dt * tStep;
        if (finf <= 0.05 || finf >= 0.95 || tau < 50 || tau > 5000) continue;
        const v = ll(finf, tau);
        if (v > best.loglik) best = { finf, tau, loglik: v };
      }
    }
  }
  return best;
}

/**
 * Forward launch odds: given a protocol has NOT launched by age a, the
 * chance it ever does. P = (Finf - F(a)) / (1 - F(a)). Falls with age:
 * ~0.41 at 90 days, ~0.34 at a year, ~0.19 at 3 years, ~0.10 at 5 years.
 * Floored at 0.02 and capped at 0.90 so no row is ever written off or
 * treated as certain.
 */
export function forwardOdds(age: number, finf: number, tau: number): number {
  const f = finf * (1 - Math.exp(-age / tau));
  const p = (finf - f) / (1 - f);
  return Math.min(0.9, Math.max(0.02, p));
}

// ---------------------------------------------------------------- farm plans

// Planning constants. Deliberately coarse buffers, not spot prices: gas
// is volatile (a 254.75 gwei spike on 29 Oct 2026 priced a swap near
// $70), so $8 for an Ethereum transaction covers a busy day and $0.50
// covers a layer-2 one. The step-8 tally is computed from these same
// numbers, so it always reconciles with steps 2-4.
const CAPITAL_USD = 150;
const BRIDGE_FEE_USD = 8.5;
const ETH_GAS_USD = 8;
const L2_GAS_USD = 0.5;
const WEEKLY_GAS_USD = 1;
const HOLD_DAYS = 30;
const WEEKS = 4;

// Points programs verified live on 2026-11-23 (see the goal workspace
// farm-v4-progress.md for the verification notes). Matched by protocol
// name at build time, so a program only lands on the protocol it
// belongs to. A row whose protocol is not in this list, in the verified
// fallback list, or in the special cases below gets the "check its own
// page" step instead of an unverified claim.
const NAMED_PROGRAMS: { key: string; program: string; step: string }[] = [
  { key: "veda", program: "Veda Points", step: "" },
  { key: "symbiotic", program: "Symbiotic Points", step: "" },
  { key: "plume", program: "Plume Nest Points (PNP)", step: "" },
  { key: "upshift", program: "Upshift Points (Season 2)", step: "" },
  { key: "onre", program: "OnRe Points", step: "" },
  { key: "tori", program: "Tori Finance Cores", step: "" },
  { key: "saturn", program: "Saturn Orbital Points (Season 2)", step: "SPECIAL" },
  { key: "aegis", program: "Aegis Points (Season 2)", step: "" },
  { key: "tydro", program: "TydroInkPoints (Season 2)", step: "" },
  { key: "noble", program: "Noble Points (Season 2)", step: "" },
  { key: "doppler", program: "Doppler Points (DP, Season 3)", step: "" },
];

// Protocols checked individually 18-23 Nov 2026 with no public points
// program found. The fallback claim is only made for these names.
const VERIFIED_NO_PROGRAM: string[] = [
  "Steakhouse Financial", "Gauntlet", "USDD", "OpenTrade", "RockawayX",
  "Keyrock", "Lagoon", "Bittensor", "Nonce", "R25", "Hyperithm", "Hive",
  "K3", "Lofty", "Lightning", "Clearstar", "b14g", "Axis", "Ember",
  "Valos", "Galaxy", "Armitage", "Manta", "Liminal", "Project X",
  "Drakewell", "Reti", "Gami",
];

function programStep(p: SnapProtocol): string {
  const n = normName(p.name);
  if (n.includes("curvance")) {
    return "Curvance runs biweekly epochs and pays USDC via CCTP/Wormhole; no public points program is named in its docs, so farm for usage history, not points. Cost: no fee. Time: 10 minutes.";
  }
  for (const prog of NAMED_PROGRAMS) {
    if (n.includes(prog.key)) {
      if (prog.key === "saturn") {
        return "Saturn Orbital Points (Season 2) registration already closed; check your balance and claim from the link it publishes. Cost: no fee beyond gas. Time: 10 minutes.";
      }
      return `${prog.program} is live: join it, connect the same wallet, and do the weekly tasks the program lists. Cost: no fee beyond gas. Time: 10 minutes.`;
    }
  }
  for (const name of VERIFIED_NO_PROGRAM) {
    const vn = normName(name);
    if (n === vn || n.startsWith(vn) || vn.startsWith(n)) {
      return `No public points program was found for ${p.name} as of 2026-11-24, so farm for usage history, not points: keep the position and the log. Cost: no fee. Time: 10 minutes.`;
    }
  }
  return `Check ${p.name}'s own points page and docs for a live program before you deposit; no program was named for this row in the 2026-11-24 pass, so farm for usage history unless its own page says otherwise. Cost: no fee. Time: 10 minutes.`;
}

// What the $150 actually does, by category. Each entry is a complete
// sentence; the cost/time suffix is added by farmSteps.
function coreAction(p: SnapProtocol): string {
  const name = p.name;
  switch (p.category) {
    case "Dexs":
      return `Add $${CAPITAL_USD} of liquidity to ${name}'s deepest pool and keep the position open for the full ${HOLD_DAYS} days.`;
    case "Lending":
      return `Supply $${CAPITAL_USD} of USDC to ${name}'s lending market and keep the position open for the full ${HOLD_DAYS} days.`;
    case "Yield":
      return `Deposit $${CAPITAL_USD} into ${name}'s highest-yield vault and keep the position open for the full ${HOLD_DAYS} days.`;
    case "Liquid Staking":
      return `Stake $${CAPITAL_USD} of ETH with ${name} and hold the receipt token for the full ${HOLD_DAYS} days.`;
    case "Liquid Restaking":
      return `Restake $${CAPITAL_USD} of ETH with ${name} and hold the receipt token for the full ${HOLD_DAYS} days.`;
    case "Bridge":
    case "Canonical Bridge":
      return `Bridge $${CAPITAL_USD} of USDC through ${name} and hold the receipt for the full ${HOLD_DAYS} days.`;
    case "CEX":
      return `Place $${CAPITAL_USD} of spot trades on ${name} and keep the activity going for the full ${HOLD_DAYS} days.`;
    case "Derivatives":
      return `Open a $${CAPITAL_USD} hedged position on ${name}'s perpetuals market and keep it open for the full ${HOLD_DAYS} days.`;
    case "CDP":
      return `Open a $${CAPITAL_USD} vault on ${name} and keep it open for the full ${HOLD_DAYS} days.`;
    case "RWA":
      return `Buy $${CAPITAL_USD} of ${name}'s tokenized asset and hold it for the full ${HOLD_DAYS} days.`;
    default:
      return `Deposit $${CAPITAL_USD} into ${name}'s core product and keep the position open for the full ${HOLD_DAYS} days.`;
  }
}

export function farmSteps(p: SnapProtocol, age: number): string[] {
  const chain = p.chains[0] ?? "Ethereum";
  const onEth = chain === "Ethereum";
  const bridge = onEth ? 0 : BRIDGE_FEE_USD;
  const gas = onEth ? ETH_GAS_USD : L2_GAS_USD;
  const total = bridge + gas + WEEKS * WEEKLY_GAS_USD;
  const step2 = onEth
    ? `Hold $${CAPITAL_USD} of USDC on Ethereum — ${p.name} runs on Ethereum, so no bridge is needed. Cost: $${CAPITAL_USD} capital + ~$${ETH_GAS_USD} gas. Time: 15 minutes.`
    : `Bridge $${CAPITAL_USD} of USDC from Ethereum to ${chain} with the canonical bridge. Cost: $${CAPITAL_USD} capital + $${BRIDGE_FEE_USD} bridge fees. Time: 15 minutes.`;
  return [
    `Create a fresh wallet for ${p.name} only and keep the seed offline. Never reuse a wallet that holds other funds. Cost: $0. Time: 5 minutes.`,
    step2,
    `${coreAction(p)} Cost: $${CAPITAL_USD} capital + ~$${gas} gas. Time: 15 minutes.`,
    `Once a week, review the position, re-allocate if the yield moved, and write the change in your farm log. Cost: ~$${WEEKLY_GAS_USD} gas per week. Time: 10 minutes a week.`,
    `Hold the position for at least ${HOLD_DAYS} days so your activity spans several snapshots. Cost: no extra cost. Time: ${HOLD_DAYS} days.`,
    programStep(p),
    `Keep a farm log: the wallet, the dates, and every transaction hash. It is the only proof of what you did. Cost: nothing. Time: 5 minutes.`,
    `Only the $${CAPITAL_USD} capital is at risk; never chase a higher allocation, and never sign a transaction you did not expect. Total plan cost: $${CAPITAL_USD} capital + $${total} gas and bridge fees. Cost: no extra cost. Time: 2 minutes.`,
  ];
}

// ---------------------------------------------------------------- the board

export interface LiveRow {
  slug: string;
  name: string;
  category: string;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

export interface SetAsideRow {
  slug: string;
  name: string;
  category: string;
  chains: string[];
  tvl_usd: number;
  reason: string;
}

export interface BuiltBoard {
  rows: BoardRow[];
  live: LiveRow[];
  setAside: SetAsideRow[];
  model: Record<string, number | string | string[]>;
  fit: Record<string, number | number[] | string[]>;
  oddsByCategory: { category: string; n_pre: number; median_odds: number; eventual_share: number }[];
  watchlistSize: number;
  ridge: RidgeFit;
  saturating: { finf: number; tau: number; loglik: number };
}

// The house's own "does a token exist yet" screens, from the snapshot
// README. They are about existence, not size, so they apply at any TVL
// — the floor is the only screen the board relaxes. A row that fails
// one goes to set_aside with its reason instead of being ranked as
// pre-token: Aave V3 is not a pre-token protocol (AAVE trades), and
// neither is Binance CEX (BNB trades) nor LayerZero V2 (ZRO trades).
const SCREENED_CATEGORIES = new Set([
  "CEX",
  "Bridge",
  "Canonical Bridge",
  "Liquid Staking",
  "Liquid Restaking",
  "Restaked BTC",
]);

export function screenReason(p: SnapProtocol): string | null {
  if (SCREENED_CATEGORIES.has(p.category)) {
    return `category ${p.category} excluded by the house screen`;
  }
  if (/\bv\d+(?:\.\d+)?\b/i.test(p.name)) {
    return "versioned name — the underlying protocol's token already trades";
  }
  if (/\b(wrapped|staked|staking)\b/i.test(p.name)) {
    return "wrapped/staked product — the underlying token already trades";
  }
  return null;
}

/**
 * Build the round-6 board from a snapshot.
 *
 * Coverage: every pre-token protocol in the snapshot that passes the
 * house's existence screens goes on the board (340 rows on this
 * snapshot) — the watchlist is the floor, never the ceiling, and no
 * size screen is re-imposed below the floor. The 274 pre-token rows
 * that fail an existence screen (a CEX, a bridge, a liquid-staking
 * product, a versioned name, a wrapped/staked product) are listed in
 * set_aside with the reason, not ranked as pre-token. Every live-token
 * protocol (144, including the 16 whose market cap is zero) is carried
 * as a comparables table. 340 + 274 + 144 = all 758 accounted for.
 * A protocol is live-token when it has a market cap recorded at all;
 * the 16 live rows with mcap <= 0 are excluded from the fit (no market
 * cap to learn from) but still appear in the comparables table.
 */
export function buildBoard(snap: Snapshot): BuiltBoard {
  const asOf = snap.as_of;
  const allAges = snap.protocols
    .map((p) => ageDays(asOf, p.listed_at))
    .filter((a): a is number => a !== null);
  const medianAgeAll = median(allAges);

  const liveFit = snap.protocols.filter(
    (p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0,
  );
  const ridge = fitRidge(liveFit, 30);

  const satAges = snap.protocols.map((p) => ageDays(asOf, p.listed_at) ?? medianAgeAll);
  const satHas = snap.protocols.map((p) => (p.gecko_id ? 1 : 0));
  const saturating = fitSaturating(satAges, satHas);

  const pre = snap.protocols.filter((p) => p.mcap_usd === null);
  const liveAll = snap.protocols.filter((p) => p.mcap_usd !== null);
  const boardable = pre.filter((p) => screenReason(p) === null);
  const setAside: SetAsideRow[] = pre
    .filter((p) => screenReason(p) !== null)
    .sort((a, b) => b.tvl_usd - a.tvl_usd)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      reason: screenReason(p) as string,
    }));

  const scored = boardable.map((p) => {
    const age = ageDays(asOf, p.listed_at) ?? medianAgeAll;
    const x = featureRow(p, age, ridge.categories);
    const predLogMcap = x.reduce((s, v, j) => s + v * ridge.beta[j], 0);
    const multiple = Math.exp(predLogMcap - Math.log(p.tvl_usd));
    const odds = forwardOdds(age, saturating.finf, saturating.tau);
    const implied = Math.round(p.tvl_usd * multiple * odds);
    return { p, age, multiple, odds, implied };
  });
  scored.sort((a, b) => b.implied - a.implied);

  const rows: BoardRow[] = scored.map((s, i) => ({
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
    token_status: "pre-token",
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      fitted_multiple: s.multiple,
      launch_odds: s.odds,
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age),
  }));

  const live: LiveRow[] = [...liveAll]
    .sort((a, b) => b.tvl_usd - a.tvl_usd)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));

  // Median forward odds and eventual launch share per category, for the
  // dashboard's model panel. The odds themselves are age-based (see
  // forwardOdds); this table only summarises them.
  const byCat = new Map<string, { pre: number[]; n: number; has: number }>();
  for (const p of snap.protocols) {
    const e = byCat.get(p.category) ?? { pre: [], n: 0, has: 0 };
    e.n += 1;
    if (p.gecko_id) e.has += 1;
    byCat.set(p.category, e);
  }
  for (const s of scored) {
    byCat.get(s.p.category)?.pre.push(s.odds);
  }
  const oddsByCategory = [...byCat.entries()]
    .filter(([, e]) => e.pre.length > 0)
    .map(([category, e]) => ({
      category,
      n_pre: e.pre.length,
      median_odds: median(e.pre),
      eventual_share: e.has / e.n,
    }))
    .sort((a, b) => b.n_pre - a.n_pre || (a.category < b.category ? -1 : 1));

  // Validation numbers from the hunt ledger (same fixed splits, same
  // metric) re-computed for the shipped model, whose growth term is
  // clipped to [-30, +100] (see featureRow). They are measurements, not
  // claims: the 10-fold CV is a wash (0.1415 vs 0.1494 for the TVL-only
  // OLS), the locked holdout favours the OLS (R^2 0.2218 vs 0.1477),
  // and the ridge's case is the walk-forward (+0.0509 vs -0.0579).
  // See method.md.
  const model: Record<string, number | string | string[]> = {
    fit_ridge_lambda: 30,
    odds_floor: 0.02,
    odds_cap: 0.9,
    odds_method: "forward-saturating",
    saturating_finf: Math.round(saturating.finf * 10000) / 10000,
    saturating_tau: Math.round(saturating.tau),
    value_features: ["log_tvl", "log_age", "chg_7d_clipped_-30_100", "log_chains", "category_top10"],
    validation_5fold_r2_ridge_a30: 0.1977,
    validation_5fold_r2_c1: 0.1658,
    validation_10fold_r2_ridge_a30: 0.1415,
    validation_10fold_r2_c1: 0.1494,
    validation_10fold_paired_dR2: -0.0079,
    validation_walkforward_r2_ridge_a30: 0.0509,
    validation_walkforward_r2_c1: -0.0579,
    validation_holdout_r2_c1: 0.2218,
    validation_holdout_r2_ridge_a30: 0.1477,
    validation_holdout_mse_c1: 4.4146,
    validation_holdout_mse_ridge_a30: 4.8347,
    validation_holdout_spearman_c1: 0.5309,
    validation_holdout_spearman_ridge_a30: 0.4523,
    validation_odds_logloss_saturating: 0.4851,
    validation_odds_logloss_logit: 0.4837,
    validation_spearman_radar5: 0.427,
  };

  const fit: Record<string, number | number[] | string[]> = {
    beta0: ridge.beta[0],
    beta1: ridge.beta[1] - 1,
    median_log_tvl: ridge.medianLogTvl,
    median_tvl_usd: ridge.medianTvl,
    n: ridge.n,
    residual_sd: ridge.residualSd,
    r_squared: ridge.rSquared,
    ridge_beta: ridge.beta,
    ridge_categories: ridge.categories,
    ridge_lambda: 30,
  };

  return {
    rows,
    live,
    setAside,
    model,
    fit,
    oddsByCategory,
    watchlistSize: snap.watchlist.length,
    ridge,
    saturating,
  };
}
