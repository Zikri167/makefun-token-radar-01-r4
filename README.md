# Token Radar — which pre-token protocol is worth the most?

![Version](https://img.shields.io/badge/version-v1-blue)
![Grade](https://img.shields.io/badge/grade-dev%20pending-lightgrey)
![Prize](https://img.shields.io/badge/prize%20pool-%241%2C325-gold)

An entry for the make.fun bounty **Token Radar** — https://make.fun/bounty/token-radar-01

## What it does

The program reads the sealed DefiLlama snapshot (758 protocols, as of 2026-11-14) and ranks the
protocols that record no token yet by an implied token value. Of the 758, 342 record no token;
applying the watchlist's own product rule (wrapped, staked, bridged and exchange products of a
token that already trades, plus version-suffixed names) leaves 198 ranked candidates — including
all 40 watchlist protocols, and reaching far below the $50M watchlist floor.

## The model

Every number is fitted on the snapshot itself, from its 128 live-token peers (recorded market cap
and at least $1M TVL):

- **Category multiple** — the median mcap/TVL of the category's live peers, winsorised at the
  5th–95th percentile and shrunk toward the global median in log space with weight n/(n+5), so
  small categories and single outlying peers cannot dominate. Categories with no live peer fall
  back to the global median and are flagged on the board.
- **Size factor** — a power law `(TVL / median peer TVL)^(β−1)` with β = 0.54 chosen by back-test:
  the program values every live peer as if pre-token for each candidate β and keeps the one with
  the smallest median error against the recorded market caps.
- **Growth factor** — a bounded tanh of the 7-day TVL change, clamped to [−40%, +150%].
- **Maturity factor** — years tracked with no token recorded; very young and very old protocols
  are discounted. **Chain-breadth factor** — the multi-chain uplift measured on the peers.
- **Range** — the category's interquartile multiples, widened 15% per missing snapshot field.
  A missing field is never read as zero: its factor is neutral, the row's confidence drops, and
  the range widens.

Calibration is published, not asserted: run back over the live peers, the model's median estimate
is within a factor of ~3.1× of the actual market cap, and the low–high range contains the actual
market cap for 57% of peers. The dashboard's calibration tab shows every peer's actual market cap
beside the model's estimate, plus the log-log fit.

Each board row carries a six-step farm plan generated from the protocol's own snapshot fields —
cheapest chain first with fee and time estimates, a category-specific core action, TVL-tiered
working capital, momentum and age cues, and a monthly review step.

## Run it

```
node main.ts --input <path-to-snapshot.json>
```

Node 22, standard library only, no network. Output goes to `$MAKEFUN_OUTPUT_DIR` (or `/output`):
`board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json`. The program is
deterministic — the same snapshot always yields byte-identical outputs — and self-checks the
board's invariants (ranks 1..N, strictly decreasing values, full watchlist coverage, farm-plan
shape) before writing anything.

## Layout

- `main.ts` — entry point: snapshot in, board + dashboard + dossier out
- `lib/model.ts` — the valuation model (peer fit, shrinkage, back-tested size exponent, factors)
- `lib/farm.ts` — deterministic farm-plan generation from snapshot fields
- `dashboard/` — the radar board, per-protocol detail view, calibration and methodology
- `screenshots/` — captures of the running dashboard
- `vendor/makefun-board.ts` — the kit's dossier builder, vendored unmodified
