// Farm plans: deterministic per protocol, built only from snapshot fields
// (category, chains, TVL, 7d change, age). Costs are planning estimates for
// gas and time on the named chain, stated as ranges, never as quotes.

import type { Protocol } from "./model.ts";

interface ChainClass {
  fee: string;
  feeRank: number;
  time: string;
}

const L2 = new Set([
  "Arbitrum",
  "Base",
  "Optimism",
  "Scroll",
  "Linea",
  "ZkSync Era",
  "Mantle",
  "Blast",
  "Mode",
  "Taiko",
  "Bob",
  "Metis",
]);
const FAST = new Set(["Solana", "Sui", "Aptos", "Near", "Sei", "Injective"]);
const CHEAP_EVM = new Set(["BSC", "Avalanche", "Polygon", "Gnosis", "Fantom", "Cronos", "Celo", "Moonbeam"]);

export function chainClass(chain: string): ChainClass {
  if (chain === "Ethereum") return { fee: "$8-25", feeRank: 5, time: "5-15 min per transaction" };
  if (L2.has(chain)) return { fee: "$0.05-0.30", feeRank: 2, time: "1-3 min per transaction" };
  if (FAST.has(chain)) return { fee: "under $0.02", feeRank: 1, time: "under a minute per transaction" };
  if (CHEAP_EVM.has(chain)) return { fee: "$0.10-1.00", feeRank: 3, time: "1-5 min per transaction" };
  return { fee: "$0.50-3.00", feeRank: 4, time: "2-10 min per transaction" };
}

export function cheapestChain(p: Protocol): string {
  let best = p.chains[0] ?? "Ethereum";
  let bestRank = Number.POSITIVE_INFINITY;
  for (const c of p.chains) {
    const r = chainClass(c).feeRank;
    if (r < bestRank) {
      bestRank = r;
      best = c;
    }
  }
  return best;
}

function capitalTier(tvl: number): { capital: string; note: string } {
  if (tvl >= 200_000_000)
    return { capital: "$2,500-5,000", note: "sized to stay under 0.01% of TVL so positions remain exitable" };
  if (tvl >= 20_000_000)
    return { capital: "$1,000", note: "sized to clear typical minimum deposits without dominating any single pool" };
  return { capital: "$250", note: "kept small: at this TVL a larger position would be a visible share of the protocol" };
}

function coreAction(category: string | null, name: string): string {
  switch (category) {
    case "Lending":
    case "Uncollateralized Lending":
      return `Supply a major stablecoin as collateral in ${name} and borrow against it at a conservative 40% loan-to-value, keeping a liquidation buffer of at least 25%`;
    case "Dexs":
      return `Provide liquidity to a correlated pair (stable/stable or the chain's main volatile pair) in ${name} and route a small swap through your own position each week`;
    case "Yield":
    case "Yield Aggregator":
    case "Farm":
      return `Deposit into the primary vault of ${name} on its highest-TVL chain and leave the position untouched across at least two reward epochs`;
    case "CDP":
    case "CDP Manager":
      return `Open a small collateralised position in ${name}: deposit collateral and mint its stablecoin at under 50% of the liquidation ratio, then hold or LP the minted stablecoin`;
    case "Derivatives":
    case "Options Vault":
    case "Interest Rate Derivatives":
      return `Trade small maker orders on ${name} (limit orders, no leverage above 2x) and deposit a separate slice into its liquidity or options vault`;
    case "RWA":
      return `Complete the onboarding/KYC flow of ${name} if it offers one and take the smallest permitted position in its flagship real-world-asset pool`;
    case "Risk Curators":
    case "Onchain Capital Allocator":
      return `Deposit into the flagship curated vault of ${name} and keep the position through at least two reallocation cycles so the activity is not a one-off`;
    case "Restaking":
      return `Restake a small amount through ${name} on its main chain and keep the restaked position active rather than withdrawing after the first epoch`;
    case "Basis Trading":
      return `Take the smallest basis position ${name} offers (spot long plus its offsetting leg) and hold it through one full funding cycle`;
    default:
      return `Use the core product of ${name} with a real position on its main chain: deposit, transact once through the main flow, and keep the position open`;
  }
}

export function farmSteps(p: Protocol, ageYears: number | null): string[] {
  const chain = cheapestChain(p);
  const cc = chainClass(chain);
  const tier = capitalTier(p.tvl_usd);
  const steps: string[] = [];

  steps.push(
    `Set up on ${chain} (cheapest of its ${p.chains.length} chain${p.chains.length === 1 ? "" : "s"}): fund a fresh wallet with ${tier.capital} of working capital plus gas; network fees there run ${cc.fee} and ${cc.time}. Setup takes about 20 minutes`,
  );
  steps.push(
    `${coreAction(p.category, p.name)}. Working capital of ${tier.capital} is ${tier.note}; expect 2-4 transactions at ${cc.fee} each to open the position`,
  );
  if (p.chains.length >= 2) {
    const other = p.chains.find((c) => c !== chain) ?? p.chains[0];
    steps.push(
      `Spread activity to ${other}: bridge a minority share (about 25% of the position) over and repeat the core action there, so usage is not single-chain. Bridging costs ${cc.fee} plus bridge fees and takes 10-30 minutes`,
    );
  } else {
    steps.push(
      `Deepen the single-chain position instead of splitting it: add a second, smaller deposit a week later (about 25% of the first), which reads as sustained use rather than a one-day spike. Cost: 1-2 transactions at ${cc.fee}`,
    );
  }
  if (p.change_7d !== null && p.change_7d > 25) {
    steps.push(
      `Note the inflow: TVL is up ${p.change_7d.toFixed(1)}% in 7 days, so any points or allocation you earn is being diluted by new money. Front-load the weekly activity below and re-check the growth rate before adding capital`,
    );
  } else if (p.change_7d !== null && p.change_7d < -25) {
    steps.push(
      `Note the outflow: TVL is down ${Math.abs(p.change_7d).toFixed(1)}% in 7 days. Keep the position at the small end of the tier, prefer withdrawable positions, and re-check TVL weekly before committing more time`,
    );
  } else {
    steps.push(
      `Keep a steady weekly cadence: one genuine interaction a week (a deposit top-up, a swap, a claim-and-restake) for at least 8 weeks. Budget 5 minutes a week plus ${cc.fee} per interaction in gas`,
    );
  }
  if (ageYears !== null && ageYears >= 2) {
    steps.push(
      `This protocol has run ${ageYears.toFixed(1)} years with no token recorded: join its governance forum or Discord, vote or delegate in any open governance process, and keep a public record of participation. About 30 minutes a month, no capital cost`,
    );
  } else if (ageYears !== null) {
    steps.push(
      `The protocol is young (${ageYears.toFixed(1)} years tracked): prioritise being an early, consistent user over size - complete any early-user or testnet-to-mainnet programme it runs. About 30 minutes a month, no capital cost`,
    );
  } else {
    steps.push(
      `Its listing date is not recorded, so treat maturity as unknown: favour consistent weekly use over governance activity until its track record is clearer. About 30 minutes a month, no capital cost`,
    );
  }
  steps.push(
    `Review monthly against this radar: if TVL falls for 3 straight checks or a token appears, close the position and recycle the capital. Total expected sunk cost is gas only (roughly 10-16 transactions at ${cc.fee}); the ${tier.capital} working capital stays recoverable while positions are open`,
  );
  return steps;
}
