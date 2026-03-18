# @deriverse/client-state

TypeScript client-state utilities for Deriverse trading workflows on Solana.

This package is designed to work alongside [`@deriverse/kit`](https://www.npmjs.com/package/@deriverse/kit) and helps maintain in-memory client instrument state while processing Deriverse engine/log events.

## Installation

```bash
npm install @deriverse/client-state
```

## What This Package Provides

- `createClientState(...)` for bootstrapping client instrument state from engine data.
- State models for spot/perp balances and in-order exposure.
- Utility functions for collateral, leverage, liquidation, and health calculations.
- `ClientState` class for applying and tracking account/instrument changes.

## Minimal Usage

```ts
import { createClientState } from "@deriverse/client-state";

const state = await createClientState({
  engine,
  rpc,
  instrIds: [1, 2]
});

if (!state) {
  throw new Error("Unable to initialize client state");
}
```

## Build

```bash
npm run build
```

## Publish

```bash
npm publish
```

## License

Apache-2.0. See [LICENSE](./LICENSE).
