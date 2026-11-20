// Token Radar model: every number below is derived from the sealed snapshot
// at run time. No protocol name, multiple or threshold is hardcoded per
// protocol; the only constants are the model's own published parameters.

export interface Protocol {
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
  protocols: Protocol[];
  watchlist: string[];
}

export interface CategoryStat {
  category: string;
  peers: number;
  medianMultiple: number;
  shrunkMultiple: number;
  shrunkLow: number;
  shrunkHigh: number;
  weight: number;
}

export interface ModelParams {
  peerCount: number;
  globalMedian: number;
  globalLow: number;
  globalHigh: number;
  beta: number;
  alpha: number;
  rSquared: number;
  refTvl: number;
  shrinkK: number;
  chainUplift: number;
  medianLogErrorFactor: number;
  bandCoverage: number;
  categories: CategoryStat[];
}

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  category: string;
  tvl_usd: number;
  change_7d: number | null;
  chains: string[];
  age_years: number | null;
  watchlist: boolean;
  implied_low_usd: number;
  implied_high_usd: number;
  multiple: number;
  peer_count: number;
  growth_factor: number;
  maturity_factor: number;
  chain_factor: number;
  size_factor: number;
  confidence: string;
}

const PRODUCT_CATEGORIES = new Set([
  "Bridge",
  "Canonical Bridge",
  "Liquid Staking",
  "Liquid Restaking",
  "Restaked BTC",
  "CEX",
]);
const VERSION_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const PRODUCT_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIX = ["Binance", "Coinbase", "Bybit", "Kraken", "Bitget", "OKX", "Bitfinex", "Gemini"];

export function isLaunchCandidate(p: Protocol): boolean {
  if (p.gecko_id !== null || p.symbol !== null) return false;
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return false;
  if (VERSION_SUFFIX.test(p.name)) return false;
  if (PRODUCT_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIX.some((e) => p.name.startsWith(e))) return false;
  return true;
}

function sortedNums(xs: number[]): number[] {
  return [...xs].sort((a, b) => a - b);
}

export function quantile(xs: number[], q: number): number {
  const s = sortedNums(xs);
  if (s.length === 0) return 0;
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return s[lo];
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

export function median(xs: number[]): number {
  return quantile(xs, 0.5);
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

export function fitModel(snap: Snapshot): ModelParams {
  const peers = snap.protocols.filter(
    (p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd >= 1_000_000,
  );
  const rawMultiples = peers.map((p) => (p.mcap_usd as number) / p.tvl_usd);
  const wLo = quantile(rawMultiples, 0.05);
  const wHi = quantile(rawMultiples, 0.95);
  const winsor = rawMultiples.map((m) => clamp(m, wLo, wHi));

  const globalMedian = median(winsor);
  const globalLow = quantile(winsor, 0.25);
  const globalHigh = quantile(winsor, 0.75);
  const refTvl = median(peers.map((p) => p.tvl_usd));

  // Log-log OLS: log10(mcap) = alpha + beta * log10(tvl) over the live peers.
  const xs = peers.map((p) => Math.log10(p.tvl_usd));
  const ys = peers.map((p) => Math.log10(p.mcap_usd as number));
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let cov = 0;
  let varX = 0;
  let varY = 0;
  for (let i = 0; i < xs.length; i++) {
    cov += (xs[i] - mx) * (ys[i] - my);
    varX += (xs[i] - mx) * (xs[i] - mx);
    varY += (ys[i] - my) * (ys[i] - my);
  }
  const beta = cov / varX;
  const alpha = my - beta * mx;
  const rSquared = (cov * cov) / (varX * varY);

  // Multi-chain breadth uplift, measured on the peers themselves.
  const multi = peers.filter((p) => p.chains.length >= 3).map((p) => (p.mcap_usd as number) / p.tvl_usd);
  const single = peers.filter((p) => p.chains.length === 1).map((p) => (p.mcap_usd as number) / p.tvl_usd);
  let chainUplift = 0;
  if (multi.length >= 3 && single.length >= 3) {
    chainUplift = clamp(median(multi) / median(single) - 1, 0, 0.45);
  }

  const shrinkK = 5;
  const byCat = new Map<string, number[]>();
  peers.forEach((p, i) => {
    const key = p.category ?? "Uncategorized";
    if (!byCat.has(key)) byCat.set(key, []);
    (byCat.get(key) as number[]).push(winsor[i]);
  });
  const categories: CategoryStat[] = [];
  for (const [category, ms] of [...byCat.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const n = ms.length;
    const w = n / (n + shrinkK);
    // Shrink in log space: multiples are ratios, so the geometric blend is
    // the natural centre — one outlying peer cannot drag a small category's
    // multiple several-fold away from the global median.
    const logShrink = (catVal: number, globVal: number) =>
      Math.exp(w * Math.log(catVal) + (1 - w) * Math.log(globVal));
    categories.push({
      category,
      peers: n,
      medianMultiple: median(ms),
      shrunkMultiple: logShrink(median(ms), globalMedian),
      shrunkLow: logShrink(quantile(ms, 0.25), globalLow),
      shrunkHigh: logShrink(quantile(ms, 0.75), globalHigh),
      weight: w,
    });
  }
  const catMap = new Map<string, CategoryStat>(categories.map((c) => [c.category, c]));

  // Back-test the size exponent on the peers themselves: for each candidate
  // beta, value every peer as if it were pre-token and take the median
  // absolute log10 error against its recorded market cap. The beta with the
  // lowest median error wins; the pooled OLS slope above is only a fallback.
  const estimate = (p: Protocol, b: number): { value: number; low: number; high: number } => {
    const cat = catMap.get(p.category ?? "Uncategorized");
    const mult = cat ? cat.shrunkMultiple : globalMedian;
    const loM = cat ? cat.shrunkLow : globalLow;
    const hiM = cat ? cat.shrunkHigh : globalHigh;
    const adj =
      Math.pow(p.tvl_usd / refTvl, b - 1) *
      growthFactor(p.change_7d) *
      maturityFactor(ageYearsOf(p, snap.as_of)) *
      chainFactor(p.chains.length, chainUplift);
    let low = loM * p.tvl_usd * adj;
    let high = hiM * p.tvl_usd * adj;
    if (p.change_7d === null) {
      low *= 0.85;
      high *= 1.15;
    }
    if (p.listed_at === null) {
      low *= 0.85;
      high *= 1.15;
    }
    return { value: mult * p.tvl_usd * adj, low, high };
  };
  let bestBeta = beta;
  let bestErr = Number.POSITIVE_INFINITY;
  for (let bi = 50; bi <= 100; bi++) {
    const b = bi / 100;
    const errs = peers.map((p) => Math.abs(Math.log10(estimate(p, b).value / (p.mcap_usd as number))));
    const m = median(errs);
    if (m < bestErr) {
      bestErr = m;
      bestBeta = b;
    }
  }
  let inside = 0;
  for (const p of peers) {
    const e = estimate(p, bestBeta);
    const actual = p.mcap_usd as number;
    if (actual >= e.low && actual <= e.high) inside++;
  }
  const bandCoverage = inside / peers.length;
  const alphaFit =
    peers.reduce((acc, p) => acc + (Math.log10(p.mcap_usd as number) - bestBeta * Math.log10(p.tvl_usd)), 0) /
    peers.length;
  let ssRes = 0;
  for (const p of peers) {
    const pred = alphaFit + bestBeta * Math.log10(p.tvl_usd);
    ssRes += (Math.log10(p.mcap_usd as number) - pred) * (Math.log10(p.mcap_usd as number) - pred);
  }
  const rSquaredFit = 1 - ssRes / varY;

  return {
    peerCount: peers.length,
    globalMedian,
    globalLow,
    globalHigh,
    beta: bestBeta,
    alpha: alphaFit,
    rSquared: rSquaredFit,
    refTvl,
    shrinkK,
    chainUplift,
    medianLogErrorFactor: Math.pow(10, bestErr),
    bandCoverage,
    categories,
  };
}

export function growthFactor(change7d: number | null): number {
  if (change7d === null) return 1;
  const g = clamp(change7d, -40, 150);
  return 1 + 0.35 * Math.tanh(g / 45);
}

export function maturityFactor(ageYears: number | null): number {
  if (ageYears === null) return 1;
  const y = ageYears;
  const f = 0.9 + (0.18 * y) / (y + 1.5) - (0.1 * Math.max(0, y - 3.5)) / 3;
  return clamp(f, 0.85, 1.1);
}

export function chainFactor(chainCount: number, uplift: number): number {
  if (chainCount < 2 || uplift <= 0) return 1;
  return 1 + Math.min(uplift, 0.15) * ((Math.min(chainCount, 4) - 1) / 3);
}

export function ageYearsOf(p: Protocol, asOf: string): number | null {
  if (p.listed_at === null) return null;
  const start = Date.parse(p.listed_at + "T00:00:00Z");
  const end = Date.parse(asOf + "T00:00:00Z");
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return Math.max(0, (end - start) / (365.25 * 24 * 3600 * 1000));
}

export function valueProtocol(
  p: Protocol,
  params: ModelParams,
  catStats: Map<string, CategoryStat>,
  asOf: string,
): Omit<BoardRow, "rank" | "farm_steps"> {
  const cat = catStats.get(p.category ?? "Uncategorized");
  const multiple = cat ? cat.shrunkMultiple : params.globalMedian;
  const lowMult = cat ? cat.shrunkLow : params.globalLow;
  const highMult = cat ? cat.shrunkHigh : params.globalHigh;
  const peerCount = cat ? cat.peers : 0;
  const sizeFactor = Math.pow(p.tvl_usd / params.refTvl, params.beta - 1);
  const gF = growthFactor(p.change_7d);
  const age = ageYearsOf(p, asOf);
  const mF = maturityFactor(age);
  const cF = chainFactor(p.chains.length, params.chainUplift);
  const adj = sizeFactor * gF * mF * cF;
  let low = lowMult * p.tvl_usd * adj;
  let high = highMult * p.tvl_usd * adj;
  let nulls = 0;
  if (p.change_7d === null) nulls++;
  if (p.listed_at === null) nulls++;
  for (let i = 0; i < nulls; i++) {
    low *= 0.85;
    high *= 1.15;
  }
  const value = multiple * p.tvl_usd * adj;
  return {
    slug: p.slug,
    name: p.name,
    implied_value_usd: Math.max(1, Math.round(value)),
    category: p.category ?? "Uncategorized",
    tvl_usd: p.tvl_usd,
    change_7d: p.change_7d,
    chains: p.chains,
    age_years: age === null ? null : Math.round(age * 100) / 100,
    watchlist: false,
    implied_low_usd: Math.max(1, Math.round(low)),
    implied_high_usd: Math.max(1, Math.round(high)),
    multiple,
    peer_count: peerCount,
    growth_factor: gF,
    maturity_factor: mF,
    chain_factor: cF,
    size_factor: sizeFactor,
    confidence: nulls === 0 ? "High" : nulls === 1 ? "Medium" : "Low",
  };
}
