// Round 7 entrypoint — token-radar-01.
// Reads /input/snapshot.json (or argv[2]), fits the value + odds models at
// runtime from the snapshot, writes /output/board.json, /output/data.js,
// copies dashboard/ + screenshots/ to /output, and writes /output/dossier.json
// with buildDossier from vendor/makefun-board.ts.
// Stdlib only, erasable TypeScript. Never deletes the output directory
// (it is a mount point at grade time; the entry runs as uid 65534).

import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDossier } from "./vendor/makefun-board.ts";
import { buildBoard, TRIM_LO, TRIM_HI } from "./lib/model.ts";
import type { Snapshot } from "./lib/model.ts";

// Fixed evaluation splits (locked before round 6; split_hash 17c48a99715a75c3).
// The holdout (26) is never fitted on during selection; the 5 folds (seed 7)
// cover the 102 selection comps. Embedded here because the entry runs in a
// sandbox with only the repo and /input/snapshot.json.
const SPLITS: { holdout_slugs: string[]; selection_slugs: string[]; folds: string[][] } = {
  holdout_slugs: ["acryptos", "api3", "aquarius-stellar", "beefy", "bitway-earn", "brickken", "cap", "chutes", "enzyme-finance", "equilibria", "evaa-protocol", "gains-network", "gravity-bridge", "harmonix-finance", "mansory", "manta-pacific", "mantle-bridge", "merlins-seal", "mexc", "quickswap-dex", "re", "serum", "thorchain-dex", "tornado-cash", "treehouse-protocol", "veno-finance"],
  selection_slugs: ["aave-v2", "across", "ankr", "anvil", "astar-dapps-staking", "aura", "b2-buzz", "babylon-protocol", "backpack", "badger-dao", "belt-finance", "benqi-lending", "biconomy.com", "bifi", "bitkan", "bitkub", "blur-bids", "cbridge", "concentrator", "concrete", "convex-finance", "cronos-zkevm-bridge", "dolomite", "eigencloud", "ekubo", "exactly", "fables", "falcon-finance", "flokifi-locker", "flying-tulip-lend", "frankencoin", "fuel-bridge", "fx-protocol", "gate", "gearbox", "grove-finance", "harvest-finance", "hegic", "hipo", "huma", "hydration-dex", "hyperlane", "index-coop", "infrared-finance", "inverse-finance-firm", "kaio", "kava-lend", "kinetic", "kyros", "lido", "liqwid", "looped-hype", "merlinswap", "metalx-lending", "meth-protocol", "morpheusai", "nexo", "obol", "okx", "osmosis-dex", "pinksale", "polygon-bridge", "portal", "pumpbtc", "railgun", "rain", "renzo", "reserve-protocol", "reservoir-protocol", "resolv-usr", "resupply", "rocket-pool", "sdai", "solomon-usdv", "solstice", "ssv-network", "stader", "starknet-bridge", "ston.fi", "streamflow", "stusdt", "superfluid", "sushiswap", "swissborg", "symbiosis", "synapse-cross-chain-bridge", "taiko-bridge", "team-finance", "tectonic", "uranium.io", "usd-ai", "usual-usd0", "veranta", "waterneuron", "wise-token", "xdai-stake-bridge", "xsy", "yield-basis", "yield-yak-aggregator", "zama", "zerobase-cedefi", "zyfai"],
  folds: [
    ["babylon-protocol", "concrete", "renzo", "anvil", "grove-finance", "zama", "reserve-protocol", "metalx-lending", "cronos-zkevm-bridge", "concentrator", "resolv-usr", "solstice", "hipo", "wise-token", "portal", "usd-ai", "bitkan", "infrared-finance", "sdai", "gate", "swissborg"],
    ["veranta", "rain", "harvest-finance", "zyfai", "ssv-network", "flokifi-locker", "streamflow", "huma", "symbiosis", "okx", "bitkub", "ankr", "stader", "stusdt", "merlinswap", "rocket-pool", "tectonic", "kava-lend", "fables", "bifi", "liqwid"],
    ["astar-dapps-staking", "morpheusai", "kyros", "eigencloud", "frankencoin", "reservoir-protocol", "blur-bids", "belt-finance", "gearbox", "starknet-bridge", "xdai-stake-bridge", "ekubo", "kaio", "hydration-dex", "flying-tulip-lend", "ston.fi", "benqi-lending", "dolomite", "biconomy.com", "resupply", "waterneuron"],
    ["fx-protocol", "yield-basis", "hegic", "superfluid", "team-finance", "railgun", "convex-finance", "nexo", "cbridge", "falcon-finance", "zerobase-cedefi", "usual-usd0", "synapse-cross-chain-bridge", "kinetic", "taiko-bridge", "hyperlane", "aave-v2", "aura", "b2-buzz", "uranium.io"],
    ["index-coop", "obol", "pinksale", "yield-yak-aggregator", "inverse-finance-firm", "badger-dao", "solomon-usdv", "fuel-bridge", "polygon-bridge", "exactly", "backpack", "xsy", "lido", "sushiswap", "osmosis-dex", "pumpbtc", "across", "looped-hype", "meth-protocol"],
  ],
};

function main(): void {
  const inputPath = process.argv[2] || "/input/snapshot.json";
  const outDir = process.argv[3] || "/output";
  const repoRoot = dirname(fileURLToPath(import.meta.url));
  const mainPath = fileURLToPath(import.meta.url);

  const snap = JSON.parse(readFileSync(inputPath, "utf8")) as Snapshot;
  const { rows, aside, liveCount, validation } = buildBoard(snap, SPLITS);

  // Board rows for the gate: whole-dollar implied values, ranks 1..N.
  const boardRows = rows.map((r) => ({
    slug: r.slug,
    name: r.name,
    rank: r.rank,
    implied_value_usd: Math.round(r.fitted_usd),
    farm_steps: r.farm_steps,
  }));

  // Fingerprint of this entrypoint, so the dashboard's integrity strip can
  // show the exact main.ts that built the board.
  const mainSha = createHash("sha256").update(readFileSync(mainPath)).digest("hex");

  mkdirSync(outDir, { recursive: true });

  writeFileSync(join(outDir, "board.json"), JSON.stringify({ rows: boardRows }, null, 1) + "\n", "utf8");

  const data = {
    meta: {
      competition: "token-radar-01",
      round: 7,
      as_of: snap.as_of,
      built_at: new Date().toISOString(),
      main_sha256: mainSha,
      model: "T-OLS (trimmed OLS log mcap on log TVL, mcap/TVL in [0.02, 2], 94 comps)",
      odds: "ridge logistic lam 0.1 on [ln TVL, log age, clipped growth], target symbol non-null, 645 dated",
      split_hash: "17c48a99715a75c3",
    },
    census: validation.census,
    verdicts: validation.verdicts,
    economics: validation.economics,
    validation,
    // Live comparables for the cap-on-TVL scatter and the comparables table.
    comps: snap.protocols
      .filter((p) => p.mcap_usd !== null && (p.mcap_usd as number) > 0)
      .map((p) => ({
        slug: p.slug,
        tvl_usd: p.tvl_usd,
        mcap_usd: p.mcap_usd as number,
        ratio: (p.mcap_usd as number) / p.tvl_usd,
        trimmed: (p.mcap_usd as number) / p.tvl_usd >= TRIM_LO && (p.mcap_usd as number) / p.tvl_usd <= TRIM_HI,
        listed_at: p.listed_at,
      })),
    rows,
    aside,
    live_count: liveCount,
  };
  writeFileSync(join(outDir, "data.js"), "var RADAR_DATA = " + JSON.stringify(data) + ";\n", "utf8");

  // Copy the dashboard and the screenshots into /output (never delete it).
  const dashSrc = join(repoRoot, "dashboard");
  const shotsSrc = join(repoRoot, "screenshots");
  if (existsSync(dashSrc)) cpSync(dashSrc, join(outDir, "dashboard"), { recursive: true });
  if (existsSync(shotsSrc)) cpSync(shotsSrc, join(outDir, "screenshots"), { recursive: true });

  // Dossier, byte-for-byte as the library writes it.
  const dossier = buildDossier(outDir, { text_max_bytes: 65536 });
  writeFileSync(join(outDir, "dossier.json"), dossier);

  // Build summary for the operator (stdout, not part of the entry).
  const v = validation.value["T-OLS-tvl"];
  console.log(JSON.stringify({
    rows: rows.length,
    aside: aside.length,
    live: liveCount,
    total: snap.protocols.length,
    watchlist: rows.filter((r) => r.watchlist).length,
    verdicts: validation.verdicts,
    tols_beta: validation.tols.beta,
    tols_se: validation.tols.se,
    value_trimmed: { r2: v.inSample.r2, miss: v.inSample.miss },
    value_full: { r2: v.full.r2, miss: v.full.miss },
    loo_trimmed: v.looFit, loo_full: v.looFull,
    wf1_trimmed: v.wf1Fit, wf2_trimmed: v.wf2Fit,
    oof: v.oof, holdout: v.holdout,
    odds_brier: validation.odds.cvBrier, odds_constant: validation.odds.constantBrier,
    odds_coefs: validation.odds.coefs, odds_se: validation.odds.bootstrapSe,
    bands: validation.bands,
    main_sha256: mainSha,
    board_bytes: JSON.stringify({ rows: boardRows }).length,
  }, null, 1));
}

main();
