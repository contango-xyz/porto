---
"porto": patch
---

Added a `bridgePreference` capability (`"fastest" | "cheapest"`, default `"cheapest"`) to `wallet_prepareCalls`/`wallet_sendCalls`, threaded from the EIP-1193 provider through `Mode.relay` and `RelayActions` into the relay request capabilities. It lets a dapp pick the speed/cost tradeoff the relay uses when sourcing funds cross-chain (e.g. CCTP fast vs standard).

Also wired the existing `useGasTank` capability through the EIP-1193 provider path (`provider` → `Mode.relay` → `RelayActions`), so it can be requested via `wallet_sendCalls`/`wallet_prepareCalls` capabilities and not only by calling `RelayActions` directly.
