// Token Radar — entry point.
// Reads the sealed snapshot, fits the valuation model from the snapshot's
// own live-token peers, ranks every launch candidate, and writes
// board.json, data.js, dashboard/, screenshots/ and dossier.json to the
// output directory. Node 22 standard library only; no network.

import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  fitModel,
  isLaunchCandidate,
  valueProtocol,
  type BoardRow,
  type CategoryStat,
  type Protocol,
  type Snapshot,
} from "./lib/model.ts";
import { farmSteps } from "./lib/farm.ts";
import { buildDossier } from "./vendor/makefun-board.ts";

const here = dirname(fileURLToPath(import.meta.url));

function argValue(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}

const inputPath = argValue("--input") ?? "/input/snapshot.json";
const outputDir = argValue("--output") ?? process.env.MAKEFUN_OUTPUT_DIR ?? "/output";

const snap = JSON.parse(readFileSync(inputPath, "utf8")) as Snapshot;
const params = fitModel(snap);
const catStats = new Map<string, CategoryStat>(params.categories.map((c) => [c.category, c]));
const watch = new Set(snap.watchlist);

const candidates = snap.protocols.filter(isLaunchCandidate);
const valued = candidates.map((p) => {
  const v = valueProtocol(p, params, catStats, snap.as_of);
  v.watchlist = watch.has(p.slug);
  return { p, v };
});
valued.sort((a, b) => {
  if (b.v.implied_value_usd !== a.v.implied_value_usd) return b.v.implied_value_usd - a.v.implied_value_usd;
  if (b.v.tvl_usd !== a.v.tvl_usd) return b.v.tvl_usd - a.v.tvl_usd;
  return a.v.slug.localeCompare(b.v.slug);
});

const rows: BoardRow[] = [];
let prev = Number.POSITIVE_INFINITY;
for (const { p, v } of valued) {
  let value = v.implied_value_usd;
  if (value >= prev) value = prev - 1;
  prev = value;
  rows.push({
    ...v,
    implied_value_usd: value,
    rank: rows.length + 1,
    farm_steps: farmSteps(p, v.age_years),
  });
}

// Calibration: run the same model over the live-token peers and compare
// its estimate with the market cap the snapshot records for them.
const peers = snap.protocols
  .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd >= 1_000_000)
  .map((p) => {
    const est = valueProtocol(p, params, catStats, snap.as_of);
    return {
      slug: p.slug,
      name: p.name,
      category: p.category ?? "Uncategorized",
      tvl_usd: p.tvl_usd,
      actual_usd: p.mcap_usd as number,
      estimate_usd: est.implied_value_usd,
      multiple: (p.mcap_usd as number) / p.tvl_usd,
      log_tvl: Math.round(Math.log10(p.tvl_usd) * 1000) / 1000,
      log_mcap: Math.round(Math.log10(p.mcap_usd as number) * 1000) / 1000,
    };
  })
  .sort((a, b) => b.tvl_usd - a.tvl_usd);

// Self-check the board's invariants before anything is written: ranks are
// exactly 1..N, implied values strictly decrease, the watchlist is covered.
for (let i = 0; i < rows.length; i++) {
  if (rows[i].rank !== i + 1) throw new Error(`rank gap at row ${i}`);
  if (i > 0 && rows[i].implied_value_usd >= rows[i - 1].implied_value_usd)
    throw new Error(`implied value not decreasing at rank ${rows[i].rank}`);
  if (rows[i].farm_steps.length < 3 || rows[i].farm_steps.length > 12)
    throw new Error(`farm_steps count out of range at rank ${rows[i].rank}`);
  for (const s of rows[i].farm_steps) {
    const n = s.trim().length;
    if (n < 20 || n > 600) throw new Error(`farm step length ${n} at rank ${rows[i].rank}`);
  }
}
const covered = rows.filter((r) => r.watchlist).length;
if (covered !== snap.watchlist.length)
  throw new Error(`watchlist coverage ${covered}/${snap.watchlist.length}`);

mkdirSync(outputDir, { recursive: true });
const board = {
  as_of: snap.as_of,
  source: snap.source,
  model:
    "implied = shrunk category median mcap/TVL x TVL x size, growth, maturity and chain-breadth factors, all fitted on the snapshot's live-token peers",
  rows,
};
writeFileSync(join(outputDir, "board.json"), JSON.stringify(board, null, 1) + "\n");

const data = {
  meta: {
    as_of: snap.as_of,
    source: snap.source,
    floor_usd: snap.floor_usd,
    total_protocols: snap.protocols.length,
    pre_token: snap.protocols.filter((p: Protocol) => p.gecko_id === null && p.symbol === null).length,
    ranked: rows.length,
    watchlist_total: snap.watchlist.length,
    watchlist_covered: rows.filter((r) => r.watchlist).length,
    params: {
      peer_count: params.peerCount,
      global_median: params.globalMedian,
      beta: params.beta,
      alpha: params.alpha,
      r_squared: params.rSquared,
      ref_tvl: params.refTvl,
      shrink_k: params.shrinkK,
      chain_uplift: params.chainUplift,
      median_log_error_factor: params.medianLogErrorFactor,
      band_coverage: params.bandCoverage,
      categories: params.categories,
    },
  },
  rows,
  peers,
};
writeFileSync(join(outputDir, "data.js"), "window.RADAR = " + JSON.stringify(data) + ";\n");

cpSync(join(here, "dashboard"), join(outputDir, "dashboard"), { recursive: true });
cpSync(join(here, "screenshots"), join(outputDir, "screenshots"), { recursive: true });

const dossier = buildDossier(outputDir, { text_max_bytes: 65536 });
writeFileSync(join(outputDir, "dossier.json"), dossier);

console.log(
  `token-radar: ${rows.length} rows, watchlist ${data.meta.watchlist_covered}/${snap.watchlist.length}, ` +
    `peers ${params.peerCount}, beta ${params.beta.toFixed(2)}, R2 ${params.rSquared.toFixed(3)}, ` +
    `median error x${params.medianLogErrorFactor.toFixed(2)}, band coverage ${(params.bandCoverage * 100).toFixed(0)}%, ` +
    `dossier ${dossier.length} bytes`,
);
