---
'porto': patch
---

Wire the `holder` capability (fund-holding portfolio + its OwnableExecutor
module) through the provider, Mode.relay and RelayActions into
`wallet_prepareCalls`/`wallet_sendCalls`, same path as `useGasTank`.
