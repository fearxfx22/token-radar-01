// main.ts — round-6 entrypoint for make.fun token-radar-01.
// Written fresh 2026-11-24. Reads a snapshot, fits the round-6 model at
// runtime, writes board.json + data.js, copies the dashboard, and builds
// the dossier once the screenshots exist.
//
// Usage:
//   MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
// Run once to build the data, take the three screenshots into
// out/screenshots/, then run again to write out/dossier.json.
import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildBoard } from "./lib/model.ts";
import type { Snapshot } from "./lib/model.ts";
import { buildDossier } from "./vendor/makefun-board.ts";

function flag(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}

const input = flag("--input") ?? "input/snapshot.json";
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? flag("--out") ?? "out";
const snap = JSON.parse(readFileSync(input, "utf8")) as Snapshot;
const built = buildBoard(snap);

mkdirSync(outDir, { recursive: true });

const board = {
  as_of: snap.as_of,
  source: snap.source,
  floor_usd: snap.floor_usd,
  watchlist_size: built.watchlistSize,
  board_size: built.rows.length,
  rows: built.rows,
};
writeFileSync(join(outDir, "board.json"), JSON.stringify(board, null, 2) + "\n");

const payload = {
  as_of: snap.as_of,
  source: snap.source,
  floor_usd: snap.floor_usd,
  model: built.model,
  model_version: "radar-6",
  watchlist_size: built.watchlistSize,
  board_size: built.rows.length,
  early_size: built.rows.length - built.watchlistSize,
  live_size: built.live.length,
  set_aside_size: built.setAside.length,
  fit: built.fit,
  odds_by_category: built.oddsByCategory,
  rows: built.rows.map((r) => ({
    rank: r.rank,
    slug: r.slug,
    name: r.name,
    category: r.category,
    chains: r.chains,
    tvl_usd: r.tvl_usd,
    change_7d: r.change_7d,
    mcap_usd: r.mcap_usd,
    listed_at: r.listed_at,
    age_days: r.age_days,
    implied_value_usd: r.implied_value_usd,
    fitted_multiple: r.model.fitted_multiple,
    launch_odds: r.model.launch_odds,
    farm_steps: r.farm_steps,
  })),
  live: built.live,
  set_aside: built.setAside,
};
writeFileSync(join(outDir, "data.js"), "window.RADAR=" + JSON.stringify(payload) + ";\n");

cpSync("dashboard", join(outDir, "dashboard"), { recursive: true });

const shotsDir = join(outDir, "screenshots");
const shots = existsSync(shotsDir)
  ? readdirSync(shotsDir).filter((f) => /\.(png|jpe?g)$/i.test(f))
  : [];
if (shots.length >= 3) {
  const dossier = buildDossier(resolve(outDir), {
    text_max_bytes: 65536,
    screenshots: { max: 4, max_bytes: 512 * 1024 },
  });
  writeFileSync(join(outDir, "dossier.json"), dossier);
  console.log(`dossier written (${shots.length} screenshots)`);
} else {
  console.log(`dossier skipped: ${shots.length} screenshot(s) in out/screenshots/ (need 3)`);
}

console.log(`board: ${built.rows.length} rows (watchlist ${built.watchlistSize}, live comparables ${built.live.length})`);
console.log(`ridge: lambda 30, n=${built.ridge.n}, R^2=${built.ridge.rSquared.toFixed(4)}, resid SD=${built.ridge.residualSd.toFixed(4)}`);
console.log(`saturating curve: Finf=${built.saturating.finf.toFixed(4)}, tau=${built.saturating.tau.toFixed(0)}d`);
console.log(`top row: ${built.rows[0].name} — implied $${built.rows[0].implied_value_usd.toLocaleString("en-US")}`);
