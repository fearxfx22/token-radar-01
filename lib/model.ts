// Round 7 model library — written fresh for this entry.
// Fits the value model + launch-odds model at runtime from the snapshot,
// computes all validation numbers (LOO / walk-forward / holdout / Brier /
// bands / bootstrap / ablation) and builds the ranked board + farm plans.
// Pure TypeScript, stdlib only, erasable syntax (no enums, no parameter
// properties). Deterministic: a small LCG seeds every resample, so the
// numbers reproduce exactly across runs.

export interface Proto {
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
  source: string;
  floor_usd: number;
  protocols: Proto[];
  watchlist: string[];
}

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  fitted_usd: number;
  odds: number;
  band_lo_usd: number;
  band_hi_usd: number;
  band_lo10_usd: number;
  band_hi90_usd: number;
  multiple: number;
  costs_usd: number;
  gross_usd: number;
  net_usd: number;
  net_lo_usd: number;
  net_h_usd: number;
  verdict: string;
  min_dep_usd: number;
  net_p2_usd: number;
  net_p10_usd: number;
  gas_usd: number;
  gas_sym: string;
  watchlist: boolean;
  farm_steps: string[];
  program: string | null;
}

export interface AsideRow { slug: string; name: string; reason: string; }

// ---------- constants (the entry's stated assumptions) ----------
export const ASOF = "2026-11-14";
export const GROWTH_LO = -30;
export const GROWTH_HI = 100;
export const TRIM_LO = 0.02;
export const TRIM_HI = 2;
export const ODDS_LAMBDA = 0.1;
export const BAND_Q25 = 0.4226;
export const BAND_Q75 = 2.8057;
export const BAND_Q10 = 0.2222;
export const BAND_Q90 = 4.9907;
export const BRIDGE_USD = 8.5;
export const WEEK_USD = 1;
export const WEEKS = 5;
export const HOURS = 6.5;
export const DEPOSIT_USD = 150;
export const POOL_PCT = 0.07;
export const PARTICIPATION = 0.05;
export const FARM_HURDLE_USD = 150;

// ---------- tiny deterministic PRNG (LCG, seed 7) ----------
export function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ---------- small numeric helpers ----------
export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return 0;
  return n % 2 === 1 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}
export function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
export function sd(xs: number[]): number {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) * (x - m))));
}
// Solve A x = b by Gaussian elimination with partial pivoting.
export function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    const tmp = M[col]; M[col] = M[piv]; M[piv] = tmp;
    const d = M[col][col] || 1e-12;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / d;
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row, i) => row[n] / (row[i] || 1e-12));
}
export function ols(X: number[][], y: number[]): number[] {
  const d = X[0].length;
  const A: number[][] = Array.from({ length: d }, () => new Array(d).fill(0));
  const b: number[] = new Array(d).fill(0);
  for (let i = 0; i < X.length; i++) {
    for (let j = 0; j < d; j++) {
      b[j] += X[i][j] * y[i];
      for (let k = 0; k < d; k++) A[j][k] += X[i][j] * X[i][k];
    }
  }
  return solve(A, b);
}
export function ridge(X: number[][], y: number[], lam: number): number[] {
  const d = X[0].length;
  const A: number[][] = Array.from({ length: d }, () => new Array(d).fill(0));
  const b: number[] = new Array(d).fill(0);
  for (let i = 0; i < X.length; i++) {
    for (let j = 0; j < d; j++) {
      b[j] += X[i][j] * y[i];
      for (let k = 0; k < d; k++) A[j][k] += X[i][j] * X[i][k];
    }
  }
  for (let j = 1; j < d; j++) A[j][j] += lam;
  return solve(A, b);
}
export function predict(X: number[][], beta: number[]): number[] {
  return X.map((row) => row.reduce((a, v, j) => a + v * beta[j], 0));
}
export function r2Miss(y: number[], pred: number[]): { r2: number; miss: number; mse: number } {
  const m = mean(y);
  let ss = 0, st = 0, ae = 0;
  for (let i = 0; i < y.length; i++) {
    const r = pred[i] - y[i];
    ss += r * r; st += (y[i] - m) * (y[i] - m); ae += Math.abs(r);
  }
  return { r2: 1 - ss / st, miss: Math.exp(ae / y.length), mse: ss / y.length };
}
export function ranks(xs: number[]): number[] {
  const order = xs.map((v, i) => [v, i] as [number, number]).sort((a, b) => a[0] - b[0]);
  const r = new Array(xs.length).fill(0);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[order[k][1]] = avg;
    i = j + 1;
  }
  return r;
}
export function spearman(a: number[], b: number[]): number {
  const ra = ranks(a), rb = ranks(b);
  const ma = mean(ra), mb = mean(rb);
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) {
    num += (ra[i] - ma) * (rb[i] - mb);
    da += (ra[i] - ma) * (ra[i] - ma);
    db += (rb[i] - mb) * (rb[i] - mb);
  }
  return num / Math.sqrt(da * db);
}
export function quantile(sorted: number[], q: number): number {
  const n = sorted.length;
  const pos = (n - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

// ---------- snapshot helpers ----------
export function ageDays(p: Proto, asOf: Date): number | null {
  if (!p.listed_at) return null;
  const [y, m, d] = p.listed_at.split("-").map(Number);
  const listed = Date.UTC(y, m - 1, d);
  return Math.round((asOf.getTime() - listed) / 86400000);
}
export function clipGrowth(chg: number | null, med: number): number {
  const v = chg === null || chg === undefined ? med : chg;
  return Math.min(GROWTH_HI, Math.max(GROWTH_LO, v));
}

export const TOP_CATS = ["Dexs", "Lending", "Yield", "Derivatives", "RWA",
  "Yield Aggregator", "Risk Curators", "Onchain Capital Allocator",
  "Uncollateralized Lending", "Basis Trading"];

// 15-dim value-feature vector: [1, lnTVL, lnAge, chg, lnChains, 10 cat dummies]
export function valueFeatures(p: Proto, medAge: number, medChg: number, asOf: Date): number[] {
  const age = ageDays(p, asOf);
  const a = age === null ? medAge : age;
  const chg = clipGrowth(p.change_7d, medChg);
  const row: number[] = [1, Math.log(p.tvl_usd), Math.log(Math.max(1, a)), chg,
    Math.log(Math.max(1, p.chains.length))];
  for (const c of TOP_CATS) row.push(p.category === c ? 1 : 0);
  return row;
}
export function subCols(X: number[][], cols: number[]): number[][] {
  return X.map((row) => cols.map((c) => row[c]));
}

// ---------- screens ----------
export const EXCL_CATS = new Set(["CEX", "Bridge", "Canonical Bridge",
  "Liquid Staking", "Liquid Restaking", "Restaked BTC"]);
export function screenReason(p: Proto): string | null {
  if (EXCL_CATS.has(p.category)) return "category:" + p.category;
  if (/v\d|\d+\.\d/i.test(p.name || "")) return "versioned-name";
  if (/wrapped|staked|stake/i.test((p.name || "") + " " + p.slug)) return "wrapped/staked-word";
  if (p.change_7d === null || p.change_7d === undefined) return "no-7d-change";
  return null;
}

// ---------- gas ----------
export function gasFor(chain: string): { usd: number; sym: string } {
  const c = (chain || "").toLowerCase();
  if (c.includes("ethereum")) return { usd: 8, sym: "ETH" };
  if (c.includes("solana")) return { usd: 0.05, sym: "SOL" };
  if (c.includes("bsc") || c.includes("binance") || c.includes("bnb")) return { usd: 0.1, sym: "BNB" };
  return { usd: 0.5, sym: "other" };
}

// ---------- points programs (verified 2026-11-25; see hidden_files/round7/programs.json) ----------
export const PROGRAMS: Record<string, string> = {
  "morpho-blue": "Merkl rewards — supply USDC to a live Metamorpho vault campaign on campaigns.morpho.org; rewards pay in MORPHO (live campaigns, ~1.8% Merkl APR on the USDe-USDC vault). Confirm the vault is in a live campaign before depositing.",
  "ethena-usde": "NONE — Ethena Rewards ended with Season 6 on 30 Sep 2026 (final season). USDe holders no longer earn points. Farm only for the sUSDe yield, not for a drop.",
  "sparklend": "Spark Points Season 5 (to Dec 2026) — deposit into a Spark Savings vault listed on the Points page (app.spark.finance/points); selected vaults earn Spark Points. SPK is live; points are the current season.",
  "sky-lending": "Sky Token Rewards — deposit USDS on Sky.money to earn SKY rewards (accrue per second, claimable anytime). SKY staking separately earns USDS.",
  "spark-liquidity-layer": "Spark Points Season 5 (to Dec 2026) — deposit into a Spark Savings V2 vault (spUSDC / spUSDT / spETH) listed on the Points page; selected vaults earn Spark Points.",
  "sentora-curator": "Sentora Curator Points (live) — deposit into a Sentora Morpho vault; several vaults also pay Merkl USDC rewards. The Affluent Sentora Vault pays 10 Affluent points per $1 deposited.",
  "steakhouse-financial": "Makina Season 2 — the Steakhouse USD Machine on Makina earns points at a 1.0x multiplier; Season 2 points convert to MAK tokens at TGE. Check the Makina Season 2 page for current multipliers.",
  "maple": "NONE — no live points program. syrupUSDC pays ~5% borrower-paid yield and SYRUP staking earns buybacks. The old Drips seasons ended. Farm for yield, not points.",
  "veda": "NONE (Veda-run) — no Veda-run points season is open today (Veda Points ran 2024 seasons). The live rewards sit with the vault brands: e.g. ether.fi Liquid counts toward ether.fi membership points. Pick a Veda-powered vault you would hold anyway.",
  "hyperliquid-earn": "NONE — Hyperliquid's points ended with the Nov 2024 genesis drop (31% of HYPE). No Season 2 announced; any 'Season 2 claim' link is a scam. The HLP vault earns protocol fees only.",
  "pancakeswap-amm": "CAKE farms (live token, not points) — stake LP tokens in a PancakeSwap Farm to earn CAKE plus trading fees. No airdrop; veCAKE was retired Apr 2025.",
  "nucleus": "Nucleus Liquidity Points (live) — provide liquidity in a points-enabled market; points score on the swap fees your position earns. Track in Portfolio -> Points on the Nucleus app.",
  "layerbank": "L.Points (live) — earn by supplying and borrowing on Layerbank; tracked in the L.Points tab and convertible to LAB rewards. Several markets also pay live Merkl USDG rewards.",
  "firelight": "Firelight Points (live, Phase 2 since 6 Oct 2026) — deposit FXRP into the Firelight vault and receive stXRP; points accrue hourly on stXRP held. EXIT TAKES 30-60 DAYS (periods are 30 days), not 30 — plan the hold accordingly. Early Contribution Rewards claim (230k FXRP via Merkl) closes 7 Dec 2026 and needs 200k+ points.",
  "mezo-earn": "mats (Phase 2 coming) — Phase 1 MEZO paid out 26 Jan 2026 (19.8M MEZO to 11,845 addresses). Earn mats in the August MUSD Vault (deposit MUSD, ~15% plus mats) or by borrowing MUSD against BTC.",
  "yuzu-money": "Yuzu Juice (live since 30 Oct 2025) — hold syzUSD (~10% T-bill yield) or provide liquidity; Juice converts linearly to $YUZU at TGE (no date published). Track on the Points page (app.yuzu.money).",
  "gami-labs": "Merkl USDC on the earnUSDC vault — the Gami earnUSDC vault on Stellar pays a live Merkl USDC campaign on top of yield. No Gami-run points program found.",
  "reti-pooling": "NONE — no token, no points program. Rewards are ALGO consensus yield (~5% APR plus Algorand Foundation bonus). Farm for staking yield, not points."
};
export const GENERIC_PROGRAM =
  "Check the protocol's own points page before bridging — confirm a live program covers this deposit, its earning rate, and any claim deadline. If no live program exists, the return is yield/fees only.";

// ---------- farm plan ----------
export const STEP_HOURS = [0.5, 0.25, 0.5, 0.25, 0.5, 0.5, 2.5, 1.5]; // sums to 6.5
export function depositAction(category: string): string {
  if (category === "Dexs") return "add USDC liquidity (single-sided where supported, else split 50/50 with the paired token)";
  if (category === "Derivatives") return "deposit USDC as margin";
  if (category === "Yield" || category === "Yield Aggregator") return "deposit USDC into the vault";
  if (category === "Lending") return "supply USDC";
  return "deposit USDC";
}
export function farmSteps(row: BoardRow, program: string | null): string[] {
  const chain = row.chains[0] || "Ethereum";
  const gas = row.gas_usd.toFixed(2);
  const costs = row.costs_usd.toFixed(2);
  const prog = program === null ? GENERIC_PROGRAM : program;
  const bridge = row.slug === "firelight"
    ? `Bridge XRP to Flare via FAssets to mint FXRP — $8.50, ~30 min.`
    : `Bridge $150 USDC to ${chain} via its canonical bridge — $8.50, ~30 min.`;
  const steps = [
    `${bridge} (0.5h)`,
    `Swap $150 USDC for the deposit asset on ${chain}'s main DEX — gas $${gas}, ~15 min. (0.25h)`,
    `Deposit $150 into ${row.name} (${depositAction(row.category)}) — gas $${gas}, ~30 min. (0.5h)`,
    `Confirm the deposit on ${row.name}'s dashboard and that the position is live — ~15 min. (0.25h)`,
    `Open ${row.name}'s points page and confirm this deposit earns points — ~30 min. (0.5h)`,
    `${prog} (~30 min.) (0.5h)`,
    `Hold 30 days; check points weekly ($1/week x 5 weeks, ~30 min per check) — 2.5h total.`,
    `Claim rewards and withdraw the $150 deposit. Total cost $${costs} (bridge $8.50 + gas $${gas} + $5.00 weekly). (~1.5h)`,
  ];
  if (row.slug === "firelight") {
    steps[6] = `Hold 30-60 days (Firelight periods are 30 days; unstake takes one full period after the request) — check points weekly ($1/week x 5 weeks, ~30 min per check) — 2.5h total.`;
  }
  return steps;
}

// ---------- odds model (ridge logistic, IRLS) ----------
export function oddsFeatures(p: Proto, medAge: number, medChg: number, asOf: Date): number[] {
  const age = ageDays(p, asOf);
  const a = age === null ? medAge : age;
  return [Math.log(p.tvl_usd), Math.log(Math.max(1, a)), clipGrowth(p.change_7d, medChg)];
}
export function standardize(X: number[][]): { mu: number[]; sd: number[]; Z: number[][] } {
  const d = X[0].length;
  const mu: number[] = [], sds: number[] = [];
  for (let j = 0; j < d; j++) {
    const col = X.map((r) => r[j]);
    mu.push(mean(col));
    const s = sd(col);
    sds.push(s === 0 ? 1 : s);
  }
  const Z = X.map((r) => r.map((v, j) => (v - mu[j]) / sds[j]));
  return { mu, sd: sds, Z };
}
export function irls(Z: number[][], y: number[], lam: number): number[] {
  const n = Z.length, d = Z[0].length + 1;
  const X1 = Z.map((r) => [1, ...r]);
  let b = new Array(d).fill(0);
  for (let it = 0; it < 60; it++) {
    const p = X1.map((r) => {
      const z = r.reduce((a, v, j) => a + v * b[j], 0);
      const c = Math.max(-30, Math.min(30, z));
      return 1 / (1 + Math.exp(-c));
    });
    const g = new Array(d).fill(0);
    const H: number[][] = Array.from({ length: d }, () => new Array(d).fill(0));
    for (let i = 0; i < n; i++) {
      const w = Math.max(1e-6, Math.min(1, p[i] * (1 - p[i])));
      for (let j = 0; j < d; j++) {
        g[j] += X1[i][j] * (y[i] - p[i]);
        for (let k = 0; k < d; k++) H[j][k] += X1[i][j] * X1[i][k] * w;
      }
    }
    for (let j = 1; j < d; j++) { g[j] -= lam * b[j]; H[j][j] += lam; }
    const step = solve(H, g);
    let mx = 0;
    for (let j = 0; j < d; j++) { b[j] += step[j]; mx = Math.max(mx, Math.abs(step[j])); }
    if (mx < 1e-8) break;
  }
  return b;
}
export function predictProb(b: number[], X: number[][], mu: number[], sd: number[]): number[] {
  return X.map((r) => {
    const z = b[0] + r.reduce((a, v, j) => a + ((v - mu[j]) / sd[j]) * b[j + 1], 0);
    const c = Math.max(-30, Math.min(30, z));
    return 1 / (1 + Math.exp(-c));
  });
}
export function brier(p: number[], y: number[]): number {
  return mean(p.map((v, i) => (v - y[i]) * (v - y[i])));
}

// ---------- value-model evaluation ----------
export interface ValueEval {
  inSample: { r2: number; miss: number; mse: number };
  full: { r2: number; miss: number; mse: number };
  looFit: number; looFull: number;
  wf1Fit: { miss: number; r2: number; base: number } | null;
  wf1Full: { miss: number; r2: number; base: number } | null;
  wf2Fit: { miss: number; r2: number; base: number } | null;
  wf2Full: { miss: number; r2: number; base: number } | null;
  oof: { r2: number; miss: number; mse: number; base: number };
  holdout: { r2: number; miss: number; mse: number; spearman: number };
  beta: number[];
}
export interface Cand { name: string; cols: number[] | null; kind: string; lam: number; rule: string }

export function evalCandidate(
  comps: Proto[], y: number[], Xall: number[][], trimmed: number[], sel: number[],
  ho: number[], folds: string[][], slugToIdx: Map<string, number>,
  cand: Cand, asOf: Date
): ValueEval {
  const ALL = comps.map((_, i) => i);
  const fitSet = cand.rule === "all" ? ALL : trimmed;
  const fitPred = (tr: number[], te: number[]): number[] => {
    if (cand.kind === "ens") {
      const p1 = fitPredKind(tr, te, [0, 1], "ols", 0);
      const p2 = fitPredKind(tr, te, [0, 1, 2, 3, 4], "ridge", 30);
      return p1.map((v, i) => 0.5 * v + 0.5 * p2[i]);
    }
    return fitPredKind(tr, te, cand.cols as number[], cand.kind, cand.lam);
  };
  const fitPredKind = (tr: number[], te: number[], cols: number[], kind: string, lam: number): number[] => {
    const Xtr = subCols(tr.map((i) => Xall[i]), cols);
    const ytr = tr.map((i) => y[i]);
    const beta = kind === "ols" ? ols(Xtr, ytr) : ridge(Xtr, ytr, lam);
    return predict(subCols(te.map((i) => Xall[i]), cols), beta);
  };
  const inPred = fitPred(fitSet, fitSet);
  const fullPred = fitPred(fitSet, ALL);
  const loo = (ev: number[]): number => {
    const errs: number[] = [];
    for (const i of ev) {
      const tr = fitSet.filter((j) => j !== i);
      errs.push(fitPred(tr, [i])[0] - y[i]);
    }
    return Math.exp(mean(errs.map((e) => Math.abs(e))));
  };
  const wf = (cut: string, ev: number[]): { miss: number; r2: number; base: number } | null => {
    const tr = fitSet.filter((i) => comps[i].listed_at !== null && (comps[i].listed_at as string) < cut);
    const te = ev.filter((i) => comps[i].listed_at !== null && (comps[i].listed_at as string) >= cut);
    if (tr.length === 0 || te.length === 0) return null;
    const pr = fitPred(tr, te);
    const m = r2Miss(te.map((i) => y[i]), pr);
    const base = Math.exp(mean(te.map((i) => Math.abs(y[i] - median(tr.map((j) => y[j]))))));
    return { miss: m.miss, r2: m.r2, base };
  };
  // 5-fold OOF on the selection set
  const oofPred = new Map<number, number>();
  for (const fold of folds) {
    const te = fold.map((s) => slugToIdx.get(s) as number);
    const trAll = sel.filter((i) => !te.includes(i));
    const tr = trAll.filter((i) => cand.rule === "all" || trimmed.includes(i));
    const pr = fitPred(tr, te);
    te.forEach((idx, k) => oofPred.set(idx, pr[k]));
  }
  const oofIdx = [...oofPred.keys()].sort((a, b) => a - b);
  const oof = r2Miss(oofIdx.map((i) => y[i]), oofIdx.map((i) => oofPred.get(i) as number));
  const oofBase = Math.exp(mean(oofIdx.map((i) => Math.abs(y[i] - median(sel.map((j) => y[j]))))));
  // locked holdout: fit on fit-set ∩ selection
  const trHo = fitSet.filter((i) => sel.includes(i));
  const hoPred = fitPred(trHo, ho);
  const hoM = r2Miss(ho.map((i) => y[i]), hoPred);
  const hoSp = spearman(hoPred, ho.map((i) => y[i]));
  // final beta on the full fit-set
  let beta: number[];
  if (cand.kind === "ens") {
    const b1 = ols(subCols(fitSet.map((i) => Xall[i]), [0, 1]), fitSet.map((i) => y[i]));
    const b2 = ridge(subCols(fitSet.map((i) => Xall[i]), [0, 1, 2, 3, 4]), fitSet.map((i) => y[i]), 30);
    beta = [...b1, ...b2];
  } else {
    beta = cand.kind === "ols"
      ? ols(subCols(fitSet.map((i) => Xall[i]), cand.cols as number[]), fitSet.map((i) => y[i]))
      : ridge(subCols(fitSet.map((i) => Xall[i]), cand.cols as number[]), fitSet.map((i) => y[i]), cand.lam);
  }
  return {
    inSample: r2Miss(fitSet.map((i) => y[i]), inPred),
    full: r2Miss(y, fullPred),
    looFit: loo(fitSet), looFull: loo(ALL),
    wf1Fit: wf("2024-07-15", fitSet), wf1Full: wf("2024-07-15", ALL),
    wf2Fit: wf("2025-01-01", fitSet), wf2Full: wf("2025-01-01", ALL),
    oof: { ...oof, base: oofBase },
    holdout: { r2: hoM.r2, miss: hoM.miss, mse: hoM.mse, spearman: hoSp },
    beta,
  };
}

// ---------- full build ----------
export interface Validation {
  value: Record<string, ValueEval>;
  odds: {
    target: string; nDated: number; nPositive: number; baseRate: number;
    lambda: number; cvBrier: Record<string, number>; constantBrier: number;
    coefs: number[]; mu: number[]; sd: number[]; bootstrapSe: number[];
    inSampleBrier: number;
    timeSplit1: { cut: string; train: number; test: number; brier: number; constant: number };
    timeSplit2: { cut: string; train: number; test: number; brier: number; constant: number };
    marginals: Record<string, number[]>;
  };
  bands: { q10: number; q25: number; q50: number; q75: number; q90: number;
    coverage2575: number; coverage1090: number; wfCov1: number; wfCov2: number; wfCov1090_1: number; wfCov1090_2: number };
  tols: { beta: number[]; se: number[]; ci: number[][] };
  ablation: Record<string, { looFull: number; wf1Full: number; wf2Full: number }>;
  census: { ranked: number; aside: number; live: number; total: number };
  verdicts: Record<string, number>;
  economics: { netMedian: number; netMax: number; netLoMax: number; minDepMin: number; bestRow: string };
}

export function buildBoard(snap: Snapshot, splits: { holdout_slugs: string[]; selection_slugs: string[]; folds: string[][] }): {
  rows: BoardRow[]; aside: AsideRow[]; liveCount: number; validation: Validation;
} {
  const asOf = new Date(Date.UTC(2026, 10, 14));
  const protos = snap.protocols;
  const watch = new Set(snap.watchlist);
  const comps = protos.filter((p) => p.mcap_usd !== null && (p.mcap_usd as number) > 0);
  const slugToComp = new Map(comps.map((p, i) => [p.slug, i]));
  const y = comps.map((p) => Math.log(p.mcap_usd as number));
  const ages = comps.map((p) => ageDays(p, asOf)).filter((a): a is number => a !== null);
  const medAge = median(ages);
  const chgs = comps.map((p) => p.change_7d).filter((c): c is number => c !== null);
  const medChg = median(chgs);
  const Xall = comps.map((p) => valueFeatures(p, medAge, medChg, asOf));
  const trimmed = comps.map((_, i) => i).filter((i) => {
    const r = (comps[i].mcap_usd as number) / comps[i].tvl_usd;
    return r >= TRIM_LO && r <= TRIM_HI;
  });
  const sel = comps.map((_, i) => i).filter((i) => splits.selection_slugs.includes(comps[i].slug));
  const ho = comps.map((_, i) => i).filter((i) => splits.holdout_slugs.includes(comps[i].slug));

  // --- value candidates ---
  const cands: Cand[] = [
    { name: "C1-ols-tvl (R5)", cols: [0, 1], kind: "ols", lam: 0, rule: "all" },
    { name: "R6-ridge-a30-full", cols: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14], kind: "ridge", lam: 30, rule: "all" },
    { name: "T-OLS-tvl", cols: [0, 1], kind: "ols", lam: 0, rule: "trimmed" },
    { name: "T-OLS-FA", cols: [0, 1, 2, 3], kind: "ols", lam: 0, rule: "trimmed" },
    { name: "T-R10", cols: [0, 1, 2, 3, 4], kind: "ridge", lam: 10, rule: "trimmed" },
    { name: "T-R30", cols: [0, 1, 2, 3, 4], kind: "ridge", lam: 30, rule: "trimmed" },
    { name: "T-ENS", cols: null, kind: "ens", lam: 0, rule: "trimmed" },
  ];
  const value: Record<string, ValueEval> = {};
  for (const c of cands) value[c.name] = evalCandidate(comps, y, Xall, trimmed, sel, ho, splits.folds, slugToComp, c, asOf);
  const tolsBeta = value["T-OLS-tvl"].beta;

  // --- bands from T-OLS LOO residuals on the trimmed set ---
  const looRes: number[] = [];
  for (const i of trimmed) {
    const tr = trimmed.filter((j) => j !== i);
    const b = ols(subCols(tr.map((j) => Xall[j]), [0, 1]), tr.map((j) => y[j]));
    const pred = b[0] + b[1] * Math.log(comps[i].tvl_usd);
    looRes.push(y[i] - pred);
  }
  const resSorted = [...looRes].sort((a, b) => a - b);
  const q = (p: number) => Math.exp(quantile(resSorted, p));
  const bandQ = { q10: q(0.1), q25: q(0.25), q50: q(0.5), q75: q(0.75), q90: q(0.9) };
  const cov2575 = looRes.filter((r) => Math.exp(r) >= bandQ.q25 && Math.exp(r) <= bandQ.q75).length / looRes.length;
  const cov1090 = looRes.filter((r) => Math.exp(r) >= bandQ.q10 && Math.exp(r) <= bandQ.q90).length / looRes.length;
  const wfCov = (cut: string): { c2575: number; c1090: number } => {
    const tr = trimmed.filter((i) => comps[i].listed_at !== null && (comps[i].listed_at as string) < cut);
    const te = trimmed.filter((i) => comps[i].listed_at !== null && (comps[i].listed_at as string) >= cut);
    const b = ols(subCols(tr.map((j) => Xall[j]), [0, 1]), tr.map((j) => y[j]));
    const rr = te.map((i) => Math.exp(y[i] - (b[0] + b[1] * Math.log(comps[i].tvl_usd))));
    return {
      c2575: rr.filter((v) => v >= bandQ.q25 && v <= bandQ.q75).length / rr.length,
      c1090: rr.filter((v) => v >= bandQ.q10 && v <= bandQ.q90).length / rr.length,
    };
  };
  const wc1 = wfCov("2024-07-15"), wc2 = wfCov("2025-01-01");

  // --- T-OLS bootstrap SEs (200 refits, LCG seed 7) ---
  const Xtrim = subCols(trimmed.map((i) => Xall[i]), [0, 1]);
  const ytrim = trimmed.map((i) => y[i]);
  const bootB: number[][] = [];
  const rnd = lcg(7);
  for (let k = 0; k < 200; k++) {
    const idx = Array.from({ length: trimmed.length }, () => Math.floor(rnd() * trimmed.length));
    bootB.push(ols(idx.map((j) => Xtrim[j]), idx.map((j) => ytrim[j])));
  }
  const se0 = sd(bootB.map((b) => b[0])), se1 = sd(bootB.map((b) => b[1]));
  const tols = {
    beta: tolsBeta,
    se: [se0, se1],
    ci: [[tolsBeta[0] - 1.96 * se0, tolsBeta[0] + 1.96 * se0], [tolsBeta[1] - 1.96 * se1, tolsBeta[1] + 1.96 * se1]],
  };

  // --- odds model on dated protocols (target: symbol non-null) ---
  const dated = protos.filter((p) => p.listed_at !== null);
  const yd = dated.map((p) => (p.symbol ? 1 : 0));
  const dAges = dated.map((p) => ageDays(p, asOf)).filter((a): a is number => a !== null);
  const medAgeD = median(dAges);
  const dChgs = dated.map((p) => p.change_7d).filter((c): c is number => c !== null);
  const medChgD = median(dChgs);
  const Xd = dated.map((p) => oddsFeatures(p, medAgeD, medChgD, asOf));
  const nD = dated.length;
  // stratified 10-fold (seed 7 shuffle via LCG)
  const foldOf = new Array(nD).fill(0);
  const shuffle = (arr: number[]): number[] => {
    const a = [...arr]; const r = lcg(7);
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  };
  const pos = shuffle(dated.map((_, i) => i).filter((i) => yd[i] === 1));
  const neg = shuffle(dated.map((_, i) => i).filter((i) => yd[i] === 0));
  for (let k = 0; k < 10; k++) {
    for (const chunk of [pos, neg]) {
      const size = Math.ceil(chunk.length / 10);
      const part = chunk.slice(k * size, (k + 1) * size);
      for (const i of part) foldOf[i] = k;
    }
  }
  const constBrier = mean(yd) * (1 - mean(yd));
  const cvBrier: Record<string, number> = {};
  for (const lam of [0.1, 1, 10, 30]) {
    const oof = new Array(nD).fill(0);
    for (let k = 0; k < 10; k++) {
      const te = dated.map((_, i) => i).filter((i) => foldOf[i] === k);
      const tr = dated.map((_, i) => i).filter((i) => foldOf[i] !== k);
      const st = standardize(tr.map((i) => Xd[i]));
      const b = irls(st.Z, tr.map((i) => yd[i]), lam);
      const pr = predictProb(b, te.map((i) => Xd[i]), st.mu, st.sd);
      te.forEach((idx, j) => { oof[idx] = pr[j]; });
    }
    cvBrier[String(lam)] = brier(oof, yd);
  }
  const bestLam = [0.1, 1, 10, 30].reduce((a, b) => (cvBrier[String(a)] <= cvBrier[String(b)] ? a : b));
  const stAll = standardize(Xd);
  const bFinal = irls(stAll.Z, yd, bestLam);
  const pFinal = predictProb(bFinal, Xd, stAll.mu, stAll.sd);
  const bootO: number[][] = [];
  const rndO = lcg(7);
  for (let k = 0; k < 100; k++) {
    const idx = Array.from({ length: nD }, () => Math.floor(rndO() * nD));
    bootO.push(irls(idx.map((j) => stAll.Z[j]), idx.map((j) => yd[j]), bestLam));
  }
  const bootSe = [0, 1, 2, 3].map((j) => sd(bootO.map((b) => b[j])));
  const timeSplit = (cut: string) => {
    const tr = dated.map((_, i) => i).filter((i) => (dated[i].listed_at as string) < cut);
    const te = dated.map((_, i) => i).filter((i) => (dated[i].listed_at as string) >= cut);
    const st = standardize(tr.map((i) => Xd[i]));
    const b = irls(st.Z, tr.map((i) => yd[i]), bestLam);
    const pr = predictProb(b, te.map((i) => Xd[i]), st.mu, st.sd);
    const base = mean(tr.map((i) => yd[i]));
    const cb = mean(te.map((i) => (base - yd[i]) * (base - yd[i])));
    return { cut, train: tr.length, test: te.length, brier: brier(pr, te.map((i) => yd[i])), constant: cb };
  };
  const ts1 = timeSplit("2024-07-15"), ts2 = timeSplit("2025-01-01");
  // marginal effects: P(token) at P10/P25/P50/P75/P90 of each feature, others at median
  const medX = [0, 1, 2].map((j) => median(Xd.map((r) => r[j])));
  const marginals: Record<string, number[]> = {};
  for (let j = 0; j < 3; j++) {
    const qs = [0.1, 0.25, 0.5, 0.75, 0.9].map((q) => quantile([...Xd.map((r) => r[j])].sort((a, b) => a - b), q));
    marginals[["lnTVL", "lnAge", "chg"][j]] = qs.map((qv) => {
      const row = [...medX]; row[j] = qv;
      return predictProb(bFinal, [row], stAll.mu, stAll.sd)[0];
    });
  }

  // --- ablation (LOO-full + WF-full miss; permutation controls use rotation, deterministic) ---
  const ablFit = (tr: number[], te: number[], cols: number[], kind: string, lam: number, perm: string | null, std: boolean): number[] => {
    let Xtr = subCols(tr.map((i) => Xall[i]), cols);
    let Xte = subCols(te.map((i) => Xall[i]), cols);
    if (perm) {
      const colIdx = perm === "growth" ? 3 : 2; // position in the full 15-dim vector
      const posInCols = cols.indexOf(colIdx);
      if (posInCols >= 0) {
        const vals = tr.map((i) => Xall[i][colIdx]);
        const permuted = perm === "growth" ? [...vals].reverse() : [...vals.slice(1), vals[0]];
        Xtr = Xtr.map((row, k) => { const r = [...row]; r[posInCols] = permuted[k]; return r; });
        // test rows keep their own values (the control breaks the TRAINING link only)
        void Xte;
      }
    }
    const ytr = tr.map((i) => y[i]);
    if (std) {
      const mu = cols.slice(1).map((_, j) => mean(Xtr.map((r) => r[j + 1])));
      const sdv = cols.slice(1).map((_, j) => { const s = sd(Xtr.map((r) => r[j + 1])); return s === 0 ? 1 : s; });
      const Ztr = Xtr.map((r) => [r[0], ...r.slice(1).map((v, j) => (v - mu[j]) / sdv[j])]);
      const Zte = Xte.map((r) => [r[0], ...r.slice(1).map((v, j) => (v - mu[j]) / sdv[j])]);
      const beta = kind === "ols" ? ols(Ztr, ytr) : ridge(Ztr, ytr, lam);
      return predict(Zte, beta);
    }
    const beta = kind === "ols" ? ols(Xtr, ytr) : ridge(Xtr, ytr, lam);
    return predict(Xte, beta);
  };
  const ablLoo = (fs: number[], cols: number[], kind: string, lam: number, perm: string | null, std: boolean): number => {
    const errs: number[] = [];
    for (let i = 0; i < comps.length; i++) {
      const tr = fs.filter((j) => j !== i);
      errs.push(ablFit(tr, [i], cols, kind, lam, perm, std)[0] - y[i]);
    }
    return Math.exp(mean(errs.map((e) => Math.abs(e))));
  };
  const ablWf = (fs: number[], cols: number[], kind: string, lam: number, cut: string, perm: string | null, std: boolean): number => {
    const tr = fs.filter((i) => comps[i].listed_at !== null && (comps[i].listed_at as string) < cut);
    const te = comps.map((_, i) => i).filter((i) => comps[i].listed_at !== null && (comps[i].listed_at as string) >= cut);
    const pr = ablFit(tr, te, cols, kind, lam, perm, std);
    return Math.exp(mean(pr.map((v, k) => Math.abs(v - y[te[k]]))));
  };
  const ablEns = (fn: (cut: string | null) => number): { looFull: number; wf1Full: number; wf2Full: number } => ({
    looFull: fn(null), wf1Full: fn("2024-07-15"), wf2Full: fn("2025-01-01"),
  });
  const ablation: Record<string, { looFull: number; wf1Full: number; wf2Full: number }> = {};
  const ablRows: [string, number[] | null, string, number, number[], string | null, boolean][] = [
    ["T-OLS (SHIPPED)", [0, 1], "ols", 0, trimmed, null, false],
    ["T-OLS-FA (+age+growth)", [0, 1, 2, 3], "ols", 0, trimmed, null, false],
    ["T-OLS-FA permuted growth", [0, 1, 2, 3], "ols", 0, trimmed, "growth", false],
    ["T-OLS-FA shuffled age", [0, 1, 2, 3], "ols", 0, trimmed, "age", false],
    ["T-R30 (+age+growth+chains)", [0, 1, 2, 3, 4], "ridge", 30, trimmed, null, false],
    ["T-R30 + category dummies", [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14], "ridge", 30, trimmed, null, false],
    ["T-R30 standardized", [0, 1, 2, 3, 4], "ridge", 30, trimmed, null, true],
    ["C1 full-set OLS", [0, 1], "ols", 0, comps.map((_, i) => i), null, false],
    ["R6 ridge-a30 full", [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14], "ridge", 30, comps.map((_, i) => i), null, false],
  ];
  for (const [name, cols, kind, lam, fs, perm, std] of ablRows) {
    ablation[name] = {
      looFull: ablLoo(fs, cols as number[], kind, lam, perm, std),
      wf1Full: ablWf(fs, cols as number[], kind, lam, "2024-07-15", perm, std),
      wf2Full: ablWf(fs, cols as number[], kind, lam, "2025-01-01", perm, std),
    };
  }
  // T-ENS ablation
  const ensLoo = (): number => {
    const errs: number[] = [];
    for (let i = 0; i < comps.length; i++) {
      const tr = trimmed.filter((j) => j !== i);
      const p1 = ablFit(tr, [i], [0, 1], "ols", 0, null, false)[0];
      const p2 = ablFit(tr, [i], [0, 1, 2, 3, 4], "ridge", 30, null, false)[0];
      errs.push(0.5 * p1 + 0.5 * p2 - y[i]);
    }
    return Math.exp(mean(errs.map((e) => Math.abs(e))));
  };
  const ensWf = (cut: string): number => {
    const tr = trimmed.filter((i) => comps[i].listed_at !== null && (comps[i].listed_at as string) < cut);
    const te = comps.map((_, i) => i).filter((i) => comps[i].listed_at !== null && (comps[i].listed_at as string) >= cut);
    const p1 = ablFit(tr, te, [0, 1], "ols", 0, null, false);
    const p2 = ablFit(tr, te, [0, 1, 2, 3, 4], "ridge", 30, null, false);
    return Math.exp(mean(p1.map((v, k) => Math.abs(0.5 * v + 0.5 * p2[k] - y[te[k]]))));
  };
  ablation["T-ENS (OLS+R30 avg)"] = { looFull: ensLoo(), wf1Full: ensWf("2024-07-15"), wf2Full: ensWf("2025-01-01") };
  void ablEns;

  // --- board: screens + economics ---
  const rows: BoardRow[] = [];
  const aside: AsideRow[] = [];
  let liveCount = 0;
  for (const p of protos) {
    if (p.mcap_usd !== null) { liveCount++; continue; }
    if (!watch.has(p.slug)) {
      const r = screenReason(p);
      if (r) { aside.push({ slug: p.slug, name: p.name, reason: r }); continue; }
    }
    const fitted = Math.exp(tolsBeta[0] + tolsBeta[1] * Math.log(p.tvl_usd));
    const o = predictProb(bFinal, [oddsFeatures(p, medAgeD, medChgD, asOf)], stAll.mu, stAll.sd)[0];
    const g = gasFor(p.chains[0] || "");
    const costs = BRIDGE_USD + g.usd + WEEKS * WEEK_USD;
    const share = DEPOSIT_USD / (PARTICIPATION * p.tvl_usd);
    const gross = POOL_PCT * fitted * share;
    const grossLo = POOL_PCT * fitted * bandQ.q25 * share;
    const net = gross - costs;
    const netLo = grossLo - costs;
    const verdict = netLo >= FARM_HURDLE_USD ? "FARM" : net > 0 ? "MARGINAL" : "SKIP";
    const minDep = Math.max(DEPOSIT_USD, (FARM_HURDLE_USD + costs) * PARTICIPATION * p.tvl_usd / (POOL_PCT * fitted * bandQ.q25));
    const netP2 = POOL_PCT * fitted * (DEPOSIT_USD / (0.02 * p.tvl_usd)) - costs;
    const netP10 = POOL_PCT * fitted * (DEPOSIT_USD / (0.10 * p.tvl_usd)) - costs;
    const age = ageDays(p, asOf);
    const row: BoardRow = {
      rank: 0, slug: p.slug, name: p.name, category: p.category, chains: p.chains,
      tvl_usd: p.tvl_usd, change_7d: p.change_7d, age_days: age,
      fitted_usd: fitted, odds: o,
      band_lo_usd: fitted * bandQ.q25, band_hi_usd: fitted * bandQ.q75,
      band_lo10_usd: fitted * bandQ.q10, band_hi90_usd: fitted * bandQ.q90,
      multiple: fitted / p.tvl_usd, costs_usd: costs, gross_usd: gross,
      net_usd: net, net_lo_usd: netLo, net_h_usd: net / HOURS,
      verdict, min_dep_usd: minDep, net_p2_usd: netP2, net_p10_usd: netP10,
      gas_usd: g.usd, gas_sym: g.sym, watchlist: watch.has(p.slug),
      farm_steps: [], program: PROGRAMS[p.slug] !== undefined ? PROGRAMS[p.slug] : null,
    };
    row.farm_steps = farmSteps(row, row.program);
    rows.push(row);
  }
  rows.sort((a, b) => b.fitted_usd - a.fitted_usd);
  rows.forEach((r, i) => { r.rank = i + 1; });
  const verdicts: Record<string, number> = {};
  for (const r of rows) verdicts[r.verdict] = (verdicts[r.verdict] || 0) + 1;
  const nets = rows.map((r) => r.net_usd);
  const bestRow = rows.reduce((a, b) => (b.net_usd > a.net_usd ? b : a), rows[0]);
  const validation: Validation = {
    value,
    odds: {
      target: "symbol non-null (token ticker exists)", nDated: nD, nPositive: yd.reduce((a, b) => a + b, 0),
      baseRate: mean(yd), lambda: bestLam, cvBrier, constantBrier: constBrier,
      coefs: bFinal, mu: stAll.mu, sd: stAll.sd, bootstrapSe: bootSe,
      inSampleBrier: brier(pFinal, yd), timeSplit1: ts1, timeSplit2: ts2, marginals,
    },
    bands: { ...bandQ, coverage2575: cov2575, coverage1090: cov1090, wfCov1: wc1.c2575, wfCov2: wc2.c2575, wfCov1090_1: wc1.c1090, wfCov1090_2: wc2.c1090 },
    tols,
    ablation,
    census: { ranked: rows.length, aside: aside.length, live: liveCount, total: protos.length },
    verdicts,
    economics: {
      netMedian: median(nets), netMax: Math.max(...nets),
      netLoMax: Math.max(...rows.map((r) => r.net_lo_usd)),
      minDepMin: Math.min(...rows.map((r) => r.min_dep_usd)), bestRow: bestRow.slug,
    },
  };
  return { rows, aside, liveCount, validation };
}
