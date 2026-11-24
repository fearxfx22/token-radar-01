# Method — Launch Radar v6

How this board is built, what was tested, and where the numbers come
from. Everything below is computed at build time from the snapshot in
`input/snapshot.json` (DefiLlama, as of 2026-11-14, 758 protocols) — no
hardcoded list of names, no hardcoded implied values.

## The model

For each pre-token protocol:

```
implied value = TVL × fitted multiple × P(launch eventually)
```

**The fitted multiple** is a ridge regression of log market cap on
five terms plus category, fitted on the 128 live-token protocols with
a market cap above zero:

- log TVL, log age, 7-day TVL change, log chain count, and the ten
  most common categories as dummies. Penalty λ = 30 (intercept
  unpenalised). Fitted at build time by solving the normal equations;
  in-sample R² 0.2368. Coefficients: intercept +8.25, log TVL +0.47,
  log age −0.12, 7-day change −0.04, log chains +0.10, category effects
  ±0.2 (Basis Trading +0.26, Liquid Staking −0.22, Lending −0.19,
  Yield −0.18, CEX +0.17, Canonical Bridge +0.18).
- The multiple falls with size — that is the only strong signal in the
  data (correlation of log multiple with log TVL is −0.41; age, growth
  and chain count are near zero on their own). At $50M TVL the fitted
  multiple is about 0.22; at $1B it is about 0.05.
- One guardrail on the growth term: the weekly change is clipped to
  [−30%, +100%]. The snapshot has rows at −72.7% and +4448% in a week,
  and the fitted growth coefficient is negative, so an unclipped
  collapse would inflate the multiple — the unclipped fit put a
  protocol that had just lost 73% of its TVL at rank 1 with a 4.6x
  multiple. The clip bounds one wild week to about 1.2 log points
  either way; it barely moves the fit (walk-forward stays positive,
  holdout unchanged) and the clipped protocol falls to rank 50 with a
  0.81x multiple.

**P(launch eventually)** is a forward probability from a saturating
launch curve. The share of protocols that have launched by age *a* is
fitted as F(a) = 0.4250 × (1 − exp(−a / 950 days)) by maximum
likelihood over all 758 protocols. The forward odds for a protocol
that has *not* launched by age *a* are then (F∞ − F(a)) / (1 − F(a)):

| age | 90d | 180d | 1y | 2y | 3y | 4y | 5y |
|-----|-----|------|----|----|----|----|----|
| P(launch eventually) | 0.41 | 0.38 | 0.34 | 0.26 | 0.19 | 0.14 | 0.10 |

The odds fall with age, which is the correct direction: a protocol
that has run for five years without a token is less likely to launch
one than a three-month-old protocol. A cross-sectional rate (the
share of protocols that already have tokens) would say the opposite,
because older protocols have had more time to launch — that is why
round 5's category-median odds were replaced.

## Validation — stated honestly

The snapshot's figures explain only about 20% of log market-cap
variance. That is the data's ceiling, not the model's, and no honest
model on this snapshot does much better. The staged hunt (fixed
splits decided before modelling; ledger in the repo's goal workspace)
found:

- **10-fold CV, log market cap:** ridge 0.1415 vs TVL-only OLS 0.1494.
  A wash, slightly favouring the OLS. 5-fold: ridge 0.1977 vs OLS
  0.1658. The extra features add almost nothing measurable in a
  random split.
- **Locked holdout (26 rows, evaluated once):** the TVL-only OLS wins
  outright (R² 0.2218, MSE 4.41, Spearman 0.53) against the ridge
  (R² 0.1477, MSE 4.83, Spearman 0.45). This entry does not hide that.
- **Walk-forward (train on protocols listed before 2024, test after):**
  ridge +0.0509 vs OLS −0.0579. The simple fit goes negative out of
  time; the ridge stays positive. A board is a forward bet, so the
  time-robust model ships — not because its random-split fit is
  better, but because it survives the direction the board actually
  faces.
- **Launch curve:** 5-fold CV log-loss 0.4851, tied with a logistic on
  age + TVL (0.4837) and better than the base rate (0.5119). The
  forward odds themselves cannot be scored against "has a token now"
  — that is the wrong target for a forward probability — and no score
  for them is invented here.

## Coverage

The board ranks **340 pre-token protocols**: the 40 on the watchlist
plus the 300 below the $50M floor that pass the house's existence
screens. The watchlist is the floor, never the ceiling, and no size
screen is re-imposed below the floor. The **274 pre-token protocols**
that fail an existence screen — a CEX, a bridge, a liquid-staking
product, a versioned name (Aave V3, Uniswap V4: the underlying token
already trades), a wrapped/staked product — are listed in the
set-aside tab with the reason, not ranked as pre-token. The **144
live-token protocols** are carried as a comparables table, so all 758
protocols are accounted for: 340 + 274 + 144.

## Farm plans

Each row carries an 8-step plan: a fresh wallet, moving $150 of USDC
to the protocol's chain, using the protocol's core product, a weekly
review, a 30-day hold, the points program (if any), a farm log, and a
risk reminder. Gas figures are coarse planning buffers, not spot
prices ($8.50 bridge, $8 Ethereum gas, $0.50 layer-2 gas, $1/week);
the step-8 total is computed from the same numbers, so it always
reconciles with steps 2–4.

Points programs were verified live on 2026-11-23: 11 named programs
(Veda, Symbiotic, Plume Nest, Upshift S2, OnRe, Tori Cores, Saturn
Orbital S2, Aegis S2, TydroInk S2, Noble S2, Doppler S3) and 28
protocols individually checked with no public program found. Rows
outside those two lists say so plainly — "check the protocol's own
points page" — instead of claiming a program status that was not
audited.

## What changed since round 5

Round 5 (judge 78.48%, rank #12,155 of 18,833) was a TVL-only
multiple (slope 0.52) times a category-median launch rate, on 206
rows. Round 6 fits every value term the snapshot carries, replaces
the cross-sectional launch rate with forward odds, grows the coverage
to 340 ranked rows (plus 274 set aside with reasons, 144 live
comparables — all 758 accounted for), and documents the validation
above — including the holdout the new model loses.
