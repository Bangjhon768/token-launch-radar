# token-launch-radar

[![token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Bangjhon768/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Bangjhon768/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01)

Token launch radar — ranking pre-token DeFi protocols by implied token value. An entry for the [make.fun](https://make.fun) bounty [Build the best token launch radar](https://make.fun/bounty/token-radar-01).

## What it does

Reads a sealed snapshot of every protocol DefiLlama tracks (758 protocols as of 2026-11-14), finds the ones that record no token, and ranks them by implied token value. The board covers the full 40-protocol watchlist (TVL ≥ $50M, no token on record) plus 164 more pre-token protocols from the whole snapshot — 204 rows in all.

## The model (radar-2)

Implied value follows only from the snapshot's own figures:

- **Peer multiple**: the trimmed median mcap/TVL of the live-token protocols in the same category, shrunk toward the market-wide median (0.186x) when the category has few live peers, capped at 1.0x.
- **Growth**: the seven-day change, square-root dampened so one hot week cannot dominate.
- **Maturity**: how long the protocol has run with no token, with diminishing returns; an unlisted age uses 365 days with a 5% discount.

Bridges and liquid-staking wrappers (85 protocols) are set aside: they move or wrap assets rather than launch tokens. Live-token protocols are set aside with their market caps shown.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input /path/to/snapshot.json
```

Node 22+, standard library only, no network. The program writes `board.json`, `data.js`, `dashboard/` and `screenshots/` to the output directory, plus `dossier.json`. Open `out/dashboard/index.html` to see the radar: a sortable, filterable board, a detail view per protocol with its model breakdown and farm plan, and a live-token view.

## License

MIT
