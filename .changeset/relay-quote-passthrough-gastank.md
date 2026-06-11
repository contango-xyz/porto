---
"porto": patch
---

Preserved unknown fields on the signed relay quote (e.g. `bridgeMeta` and its free-form adapter blob) by switching the `Quote`/`Quotes`/`Signed` schemas to loose objects, so bridging flows survive the `wallet_prepareCalls` → `wallet_sendPreparedCalls` round-trip the relay re-hashes. Added a `useGasTank` field to the `prepareCalls` meta capability and forwarded it through `RelayActions.prepareCalls`.
