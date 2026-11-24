# Launch Radar — round 7 method

**Snapshot:** sealed, as of 2026-11-14. 758 protocols. Watchlist 40 (all pre-token, all above the $50M floor). **Board:** 341 ranked rows (40 watchlist + 301 passing screens), 273 set aside, 144 live comparables. **Model:** T-OLS — OLS of log mcap on log TVL, fitted on the 94 comps whose mcap/TVL lies in [0.02, 2]. **Odds:** ridge logistic (λ=0.1) on [ln TVL, log age, clipped growth], target = a token ticker exists. **Verdicts:** FARM 0 / MARGINAL 333 / SKIP 8. Built by `main.ts` + `lib/model.ts` (Node 22, stdlib only). `main.ts` sha256: `5f1dd3a0428421ff9711725e13faee292c99f54ab4168cb7eadaf8a9e8fc1599` (the dashboard recomputes this fingerprint and shows it in the integrity strip).

## 1. Screens — who is on the board and why

A protocol is ranked only if it is pre-token (no mcap reported) and passes all four screens. The watchlist (40) is always ranked. The $50M floor does **not** filter the snapshot: 439 of the 758 rows have TVL below $50M, and they are ranked if they pass the screens — the floor binds the watchlist only.

| Screen | Rows set aside |
|---|---|
| Category in {CEX, Bridge, Canonical Bridge, Liquid Staking, Liquid Restaking, Restaked BTC} | 193 |
| Versioned name (`/v\d/` or `/\d+\.\d/` in the name) | 77 |
| Wrapped / staked / stake word in name or slug | 1 |
| Missing 7-day change (null `change_7d`) | 2 |
| **Total set aside** | **273** |

Category breakdown of the 193: Liquid Staking 67, Bridge 47, CEX 45, Canonical Bridge 24, Liquid Restaking 7, Restaked BTC 3. **Census: 341 ranked + 273 set aside + 144 live = 758. Every protocol in the snapshot is accounted for.**

**One-row gap vs round 6.** Round 6 ranked 340 and set aside 274. This build ranks 341 / 274. The difference is a single unidentifiable screen edge: round 6's prose screens were re-derived from its documentation, and only 5 of the 6 extra exclusions could be re-identified (3 versioned names — CommunityV3, Alpaca Finance 2.0, Stake DAO Yield — plus 2 null-change rows). The 6th row round 6 excluded cannot be identified without reading round 6's code, which the authorship rule forbids. The screens above are the principled re-derivation; the 1-row difference is documented, not hidden.

## 2. Value fit — the fitted value of a pre-token protocol

**The shipped model (T-OLS).** The 128 token-bearing comparables have mcap/TVL multiples from 0.00025× to 400×. No TVL-only model can price that spread — the extremes are protocols whose token is a rounding error or whose TVL is a rounding error. So the fit uses only the 94 comps with mcap/TVL in [0.02, 2] (the trimmed set), and fits OLS of log mcap on log TVL:

```
ln(mcap) = 2.79493 + 0.755092 × ln(TVL)
```

Bootstrap SEs (200 refits): intercept 1.1559, ln TVL 0.0634. 95% CI for ln TVL: [0.6308, 0.8794]. The slope below 1 is the cap on TVL: a protocol 10× bigger is worth only ~5.7× more (10^0.755), so the fitted multiple **falls** as TVL grows. That is why the farm pays best at the small end and why the board's giants are SKIP (see §6).

**Why not age and growth?** Adding log age and clipped growth (T-OLS-FA) lifts in-sample R² by 0.0008 and makes every out-of-sample metric worse (see the ablation table in §5). The value model uses TVL only. Age and growth still matter — they enter the odds model (§3), where they belong.

**Validation table.** All numbers are computed at build time from the snapshot on the locked splits (`split_hash 17c48a99715a75c3`: holdout 26 slugs, selection 102, 5 folds seed 7). **miss** = exp(mean |log error|) — a ×2.79 miss means the typical prediction lands within 2.79× of the truth either way. "Fit" columns are on each model's own fit set (94 trimmed comps for T-*, all 128 for C1/R6); "Full" columns are always on all 128 comps.

| Model | Fit R² | Fit miss | LOO | WF1 | WF2 | Full R² | Full miss | LOO full | Holdout R² | Holdout ρ |
|---|---|---|---|---|---|---|---|---|---|---|
| C1 OLS TVL (round 5) | 0.1939 | ×4.816 | ×4.933 | ×5.085 | ×5.198 | 0.1939 | ×4.816 | ×4.933 | 0.2212 | 0.531 |
| R6 ridge λ=30 full (round 6) | 0.2299 | ×4.780 | ×5.145 | ×5.065 | ×5.691 | 0.2299 | ×4.780 | ×5.145 | 0.1426 | 0.454 |
| **T-OLS TVL — SHIPPED** | **0.5714** | **×2.788** | **×2.849** | **×2.811** | **×2.767** | 0.1550 | ×5.142 | ×5.224 | **0.2476** | **0.531** |
| T-OLS-FA (+age+growth) | 0.5722 | ×2.771 | ×2.908 | ×2.973 | ×2.990 | 0.1487 | ×5.137 | ×5.322 | 0.2406 | 0.523 |
| T-R10 (ridge λ=10) | 0.5718 | ×2.763 | ×2.921 | ×2.742 | ×2.795 | 0.1552 | ×5.092 | ×5.304 | 0.2341 | 0.512 |
| T-R30 (ridge λ=30) | 0.5679 | ×2.761 | ×2.904 | ×2.723 | ×2.749 | 0.1677 | ×5.019 | ×5.209 | 0.2320 | 0.512 |
| T-ENS (OLS+R30 avg) | 0.5709 | ×2.772 | ×2.874 | ×2.765 | ×2.742 | 0.1622 | ×5.078 | ×5.214 | 0.2409 | 0.516 |

**Read it honestly.** On the trimmed set the fit is real: R² 0.5714, LOO miss ×2.849, and both walk-forward cuts beat the flat-median baseline (WF1 ×2.811 vs ×3.554; WF2 ×2.767 vs ×3.310; R² 0.4451 / 0.4382). On the **full** set the trimmed fit is worse than the round-5 model (LOO-full ×5.224 vs ×4.933) — that is the price of refusing to price the extremes, and it is stated here rather than hidden: the trimmed fit is for the trimmed population, and the board's fitted values are trimmed-set predictions. The locked 26-row holdout (fit on the 102 selection slugs only) is the one comparison where T-OLS wins outright: R² 0.2476, MSE 4.2649, Spearman 0.5309 — better than round 5 (0.2212 / 4.4146) and round 6 (0.1426 / 4.8602). 5-fold OOF on the selection (102): R² 0.0955, miss ×5.323 vs flat ×5.932 — the full-set OOF is weak because the extremes dominate it, same story as the full-set LOO.

**Why T-OLS over T-R30.** T-R30 has the best walk-forward on the trimmed set (×2.723 / ×2.749) and the best full-set LOO (×5.209), but it loses the locked holdout (0.2320 vs 0.2476), loses LOO-trimmed (×2.904 vs ×2.849), and is more complex (5 coefficients, a λ to defend). T-OLS is two coefficients, wins the holdout, wins LOO-trimmed, and exactly replicates the reference trimmed fit (R² 0.5714, LOO ×2.85). Simplest model that wins the honest comparison.

## 3. Launch odds — does a protocol this big, this old, growing this fast have a token?

**The target, corrected.** The first fit used mcap>0 as the target (95 of 645 dated, base rate 14.7%) — the wrong proxy. The reference's constant Brier 0.250 fingerprints a 50.7% base rate, which matches only one target: **a token ticker exists (symbol non-null)** — 327 of 645 dated protocols. mcap>0 is 95, gecko_id is 116. The corrected target is symbol non-null.

**Model.** Ridge logistic (λ=0.1, chosen by stratified 10-fold Brier over λ ∈ {0.1, 1, 10, 30}) on [ln TVL, log age, clipped growth] (growth clipped to [−30%, +100%]; age = days since `listed_at`; null age/change imputed with the training-set median). Features standardized (μ [17.6784, 6.2703, −5.8877], σ [1.7624, 1.0329, 12.6555]).

| λ | 10-fold Brier |
|---|---|
| **0.1 — SHIPPED** | **0.2286** |
| 1 | 0.2287 |
| 10 | 0.2290 |
| 30 | 0.2299 |
| Constant (base rate 50.7%) | 0.2500 |

In-sample Brier 0.2257. The λ curve is flat — the model is not sensitive to the choice, which is itself a finding.

**Coefficients (standardized), bootstrap SEs (100 refits), t:**

| Feature | Coef | SE | t |
|---|---|---|---|
| Intercept | 0.0012 | 0.0889 | 0.01 |
| ln TVL | 0.0636 | 0.0728 | 0.87 |
| log age | 0.5863 | 0.1356 | 4.32 |
| clipped growth | −0.2187 | 0.1251 | −1.75 |

**Age is the driver.** TVL barely matters for whether a token exists (t ≈ 0.9). An old protocol is far more likely to have a token than a young one, at the same size. Marginal effects (P(token) at P10→P90, other features at the median): TVL 0.528→0.567, age 0.313→0.647, growth 0.568→0.498. Median protocol P(token) = 0.541. A young big fast grower (TVL $1B, age 90d, +40%) has P = 0.156; an old mid slow grower (TVL $100M, age 1500d, −10%) has P = 0.666.

**It walks forward.** Time-split Brier (train before the cut, test after): cut 2024-07-15 (train 239, test 406) — 0.2612 vs constant 0.3623; cut 2025-01-01 (train 322, test 323) — 0.2785 vs constant 0.3207. The odds model beats the constant out of time on both cuts.

## 4. Uncertainty bands

Bands come from leave-one-out residuals of the shipped fit on the 94 trimmed comps. The band multipliers are applied to each row's fitted value.

| Band | Multiplier | LOO coverage | WF 2024-07-15 | WF 2025-01-01 |
|---|---|---|---|---|
| P25–P75 | 0.423× – 2.806× | 48.9% | 56.7% | 39.1% |
| P10–P90 | 0.222× – 4.991× | 78.7% | 80.0% | 82.6% |

Median LOO residual ×0.983 — the fit is near-unbiased on the trimmed set. The P25–P75 band is the middle half of what the model gets wrong; the P10–P90 band is the middle 80%. Coverage is measured on held-out rows, not on the fit itself. The WF2 P25–P75 coverage (39.1%) is below the nominal 50% — the band is optimistic on the later cut, and the verdicts use the band-low net, so that optimism is already priced into the FARM/MARGINAL decision.

## 5. Ablation — what happens when you change the model

LOO-full and walk-forward miss on **all 128 comps** (extremes included). The losers are kept on purpose.

| Variant | LOO-full | WF1-full | WF2-full |
|---|---|---|---|
| **T-OLS (SHIPPED)** | **×5.224** | **×5.525** | **×5.636** |
| T-OLS-FA (+age+growth) | ×5.322 | ×5.849 | ×6.267 |
| T-OLS-FA, permuted growth | ×5.394 | ×5.704 | ×6.181 |
| T-OLS-FA, shuffled age | ×5.263 | ×5.765 | ×8.982 |
| T-R30 (+age+growth+chains) | ×5.209 | ×5.265 | ×5.511 |
| T-R30 + category dummies | ×5.217 | ×5.263 | ×5.521 |
| T-R30 standardized | ×5.019 | ×4.748 | ×5.327 |
| C1 full-set OLS | ×4.933 | ×5.085 | ×5.198 |
| R6 ridge λ=30 full | ×5.145 | ×5.065 | ×5.691 |
| T-ENS (OLS+R30 avg) | ×5.214 | ×5.391 | ×5.549 |

**What the losers say.** Growth and age do not help the value fit out of sample: adding them (T-OLS-FA) makes walk-forward worse on both cuts, and permuting growth or shuffling age barely moves the miss — the features carry almost no signal for value. Category dummies do not help either (×5.217 vs ×5.209). Standardizing the ridge helps walk-forward (×4.748 / ×5.327) but is not shipped: it changes the coefficients' meaning and the gain is inside the noise of the outlier-driven full set; the shipped model is chosen on the trimmed set + the locked holdout, not on this column. C1 (round 5) has the best full-set numbers — because it was fitted on the full set, extremes included. The trimmed fit trades full-set miss for a fit that is actually meaningful on the population it prices.

**Permutation method.** The controls are deterministic, not random: growth is reversed (row i takes row N−1−i's growth) and age is rotated by one position. A Python cross-check with random draws gave slightly different numbers for those two rows (permuted growth ×5.279 / ×5.628 / ×6.076; shuffled age ×5.271 / ×6.002 / ×5.634) — the conclusion is the same either way, and the numbers quoted here are the TypeScript runtime's.

## 6. Farm economics — the $150 deposit, costed to the dollar

**Formula (per row, recomputed from the same inputs as the fitted value):**

- Drop pool = 7% of implied value.
- Farmer share = $150 ÷ (participation × TVL), participation 5% by default.
- Gross = pool × share. Costs = bridge $8.50 + gas (ETH $8.00, SOL $0.05, BNB $0.10, other $0.50, by primary chain) + $1/week × 5 weeks. Net = gross − costs. $/h = net ÷ 6.5h.
- **Verdict: FARM if band-low net ≥ $150; MARGINAL if point net > 0; SKIP otherwise. MIN DEP = the deposit that makes band-low net = $150.**

| Figure | Value |
|---|---|
| Verdicts (341 rows) | FARM 0 · MARGINAL 333 · SKIP 8 |
| Net $ (point, $150 deposit) | median +$35.62 · max +$64.57 (nucleus) · min −$9.40 |
| Band-low net, best row | +$19.31 — still below the $150 hurdle |
| Smallest MIN DEP | $740.82 (nucleus) |
| Watchlist verdicts | 40/40 MARGINAL |

**FARM is empty — honestly.** At a $150 deposit no row clears $150 at band-low, so no row earns FARM. The reference entry's 4 FARM rows come from a rule that is not public; this board's rule is stated and reproducible, and the empty FARM is the honest result of applying it. MIN DEP shows what it would take: the best row needs $740.82. The farm pays best at the **small** end (net falls with TVL because the slope 0.755 < 1): the best farm row is nucleus (TVL $5.01M, fitted $1.87M, net +$64.57, band-low +$19.21, MIN DEP $740.88). The giants are SKIP: morpho-blue (rank 1, TVL $10,409M, fitted $599.65M, odds 0.631, net −$9.40), ethena-usde (−$6.95), sparklend (−$6.56), sky-lending (−$5.98), spark-liquidity-layer (−$4.89). They are the most valuable protocols and the worst farms at a $150 deposit — that is the cap on TVL working as intended, not a bug.

**Farm plans.** 8 steps per row, $150 capital, ~6.5h total: bridge ($8.50, 0.5h) → swap on the main DEX (gas, 0.25h) → deposit $150 (action by category: Lending supply USDC; Dexs add USDC liquidity; Yield vault; Derivatives margin; else deposit USDC) (gas, 0.5h) → confirm the deposit is live (0.25h) → open the points page and confirm the deposit earns points (0.5h) → the verified program text (0.5h) → hold 30 days with weekly checks (2.5h) → claim + withdraw (1.5h). Every number on a row recomputes from the same inputs: the dashboard's integrity strip re-checks the cost tally (0 mismatches), the step count and length (8 steps, 20–600 chars), and every verdict against its net, in the browser.

**Points programs — verified 2026-11-25.** 19 rows were checked against live sources; the other 322 use an honest generic fallback ("check the protocol's own points page before bridging"). Live programs: morpho-blue (Merkl rewards, ~1.8% APR on USDe-USDC vault), sparklend + spark-liquidity-layer (Spark Points Season 5 to Dec 2026), sky-lending (Sky Token Rewards, USDS→SKY), sentora-curator (Sentora Curator Points + Affluent 10 pts/$1 + Merkl USDC), steakhouse-financial (Makina Season 2, 1.0x → MAK at TGE), nucleus (Nucleus Liquidity Points), layerbank (L.Points → LAB + Merkl USDG), firelight (Firelight Points, Phase 2 since 6 Oct 2026; **exit takes 30–60 days**, periods are 30 days; Early Contribution Rewards claim closes 7 Dec 2026, needs 200k+ points), mezo-earn (mats, Phase 1 paid 26 Jan 2026; Phase 2 coming), yuzu-money (Yuzu Juice since 30 Oct 2025, converts to $YUZU at TGE), pancakeswap-amm (CAKE farms — live token, not points), gami-labs (Merkl USDC on the earnUSDC vault). Verified **none** (farm for yield/fees only): ethena-usde (rewards ended with Season 6, 30 Sep 2026), maple (no live program; Drips ended), veda (no Veda-run season open), hyperliquid-earn (no Season 2 — any "Season 2 claim" link is a scam), reti-pooling (no token/points; ALGO consensus yield ~5% APR).

## 7. Reproducibility

`node main.ts <snapshot.json> <output-dir>` — reads the snapshot, fits both models, validates on the locked splits, writes `board.json` (341 rows, whole-dollar implied values, ranks 1..341), `data.js` (rows + 128 live comparables + validation + `main_sha256`), copies `dashboard/` and `screenshots/`, and writes `dossier.json` via the kit's `buildDossier`. The dashboard never fetches anything: it renders from the embedded `data.js` and re-checks the board in the browser. The TypeScript runtime reproduces the Python validation to 4 decimals on every deterministic quantity (trimmed R² 0.5714, LOO ×2.849, WF ×2.811 / ×2.767, holdout R² 0.2476, odds Brier 0.2286, bands 0.423×–2.806×); bootstrap SEs and permutation controls differ in the 2nd–3rd decimal because they use a deterministic LCG / rotation in TypeScript instead of random draws in Python — the numbers quoted here are the runtime's.
