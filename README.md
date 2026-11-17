# Token Radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/fearxfx22/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/fearxfx22/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

An entry for make.fun **token-radar-01**, "Build the best token launch radar"
($1,325 in prizes, $1,000 to the winner, entries close 2026-12-14 17:10 WIB).
The bounty is at make.fun under token-radar-01.

## What it is

A program (Node 22, standard library only) reads the sealed DefiLlama
snapshot (`/input/snapshot.json`, as of 2026-11-14, 758 protocols) and ranks
the 178 pre-token protocols worth watching, by the value a token launch would
imply. The dashboard is a static page, no network and no framework, with the
ranked board, a live-token view, a set-aside list, the full methodology, and
a detail view with the model breakdown and an eight-step farm plan per
protocol.

## The model (radar-2)

```
implied = TVL × multiple(category) × growth × breadth × maturity
```

- **multiple(category)** — the live market's price per TVL dollar in that
  sector: the median market-cap-to-TVL ratio of the live protocols in the
  category that have a market cap. Five or more comparables are required,
  otherwise the overall live median, 0.1689, is used. Calibrated on the
  snapshot itself.
- **growth** — 1 + (7-day TVL change, clamped to −60%…+120%) ÷ 100 × 0.5.
- **breadth** — 1 + 0.02 per chain beyond the first, capped at 1.10.
- **maturity** — 0.6 + min(age, 1,095 days) ÷ 1,095 × 0.4; age unknown means
  365 days.

The board is the whole 40-protocol watchlist plus every clean pre-token
protocol below the $50M floor (138 more). Twenty protocols above the floor
that the watchlist leaves out are shown in a Set-aside view, not ranked:
the watchlist rule names a parent protocol for them, so they are
sub-products or arms of a larger protocol, not launches of their own.
Live-token protocols are shown apart at their market caps. See `PLAN.md`
for the full analysis and `dashboard/index.html` for the methodology the
judge reads.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json|directory>
```

Writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and
`dossier.json` into the output directory. Two runs write identical bytes.

## Files

- `main.ts` — entry point: snapshot in, board + dashboard + dossier out.
- `lib/model.ts` — the value model, the farm plans, the board gate check.
- `vendor/makefun-board.ts` — make.fun's dossier library, copied verbatim
  from the kit (a copy elsewhere counts as lines written).
- `dashboard/` — `index.html`, `app.css`, `app.js` (37,271 bytes total —
  the whole source fits the dossier's 65,536-byte text cap).
- `screenshots/` — `1-board.png`, `2-detail.png`, `3-filtered.png`
  (1440×900, taken with headless Chrome from the built dashboard).
- `PLAN.md` — the ranking methodology and farm-plan design.
- `out/` — the last verified build (board, dossier, screenshots).

## Verified 2026-11-17 (polished, re-submit pending)

- Board: 178 rows, all 40 watchlist slugs covered, ranks 1..178, implied
  values non-increasing ($403,989,561 → $199,345), every row carries an
  eight-step farm plan (20–600 chars per step). Gate check: clean.
  The ranking model (radar-2) and board.json are unchanged from the
  submitted entry. The polish is presentation only: the dashboard is
  restyled as a newsprint broadsheet (slab-serif display, serif body,
  hairline rules instead of boxed cards), the methodology panel now
  draws the factor chain for the top protocol, and the column headers
  sort from the keyboard as well as the mouse.
- Detail view: names the live protocols each sector multiple is the
  median of (for example Risk Curators: Api3, the only live one), and
  adds a "What to watch" note per protocol (fallback multiple, shrinking
  TVL, short record). An earlier polish fixed a real error: the
  methodology had claimed Risk Curators had no live comparable at all,
  and it has one (Api3).
- Dossier: rebuilds byte-identical from the output directory; text
  37,540 bytes with no cut line — the judge reads the whole source.
  Dashboard source 37,271 bytes in 3 files.
- Determinism: two runs, byte-identical output.
- Top of the board: Steakhouse Financial $404.0M, Gauntlet $240.6M,
  Veda $231.3M, USDD $150.5M, Upshift $83.0M.

## License

MIT — see `LICENSE` (make.fun team).
