# @deriverse/client-state

TypeScript client-state utilities for Deriverse trading workflows on Solana.

This package is designed to work alongside [`@deriverse/kit`](https://www.npmjs.com/package/@deriverse/kit) and [`@solana/kit`](https://www.npmjs.com/package/@solana/kit). It maintains in-memory client token and instrument state while processing Deriverse engine/log events.

## Requirements

- Node.js 20 or newer.
- CommonJS runtime.
- Runtime dependencies on `@deriverse/kit` and `@solana/kit`.

## Installation

```bash
npm install @deriverse/client-state
```

## What This Package Provides

- `createClientState(...)` for initializing token and instrument state from a Deriverse `Engine`, Solana `rpc`, and selected `instrIds`.
- State models for token balances, spot/perp order maps, PnL, fees/rebates, pending spot tokens, perp leverage, funding, loss coverage, lookup table data, sequence numbers, and per-instrument update slots.
- Utility functions for in-order exposure, collateral value, withdrawable funds, effective leverage, liquidation price, good-health price, and health calculations.
- `ClientState.update(engine, slot, logsNotifications)` for applying Deriverse engine/log events and invoking optional callbacks, including slot-aware deposit and withdraw handlers.

## Minimal Usage

```ts
import { createClientState } from "@deriverse/client-state";

const state = await createClientState({
  engine,
  rpc,
  instrIds: [1, 2],
  onError: async (report, error) => {
    console.error(error, report);
  },
  onDeposit: (report, previousWithdraw, slot) => {
    console.log("deposit", report, slot);
  },
  onWithdraw: (report, previousDeposit, slot) => {
    console.log("withdraw", report, slot);
  }
});

if (!state) {
  throw new Error("Unable to initialize client state");
}

// Later, when a log notification arrives:
state.update(engine, slot, logsNotification);
```

`createClientState(...)` returns `null` when required engine state cannot be initialized, including missing instruments, existing spot state, or existing open perp orders for the requested instruments.

## Solana Program IDs And Versions

| Network | Program ID | Version |
| --- | --- | --- |
| Mainnet | `DRVSpZ2YUYYKgZP8XtLhAGtT1zYSCKzeHfb4DgRnrgqD` | `1` |
| Devnet | `CDESjex4EDBKLwx9ZPzVbjiHEHatasb5fhSJZMzNfvw2` | `7` |

## Build

```bash
npm run build
```

## Publish

```bash
npm run build
npm pack --dry-run
npm publish
```

The `prepack` script runs `npm run build` automatically, but check the generated `dist` files before publishing.

## License

Apache-2.0. See [LICENSE](./LICENSE).
