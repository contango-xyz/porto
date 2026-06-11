import { describe, expect, test } from 'vitest'
import { createClient, custom } from 'viem'
import { base } from 'viem/chains'
import * as Account from './Account.js'
import * as Key from './Key.js'
import * as RelayActions from './RelayActions.js'

// Isolated unit test — no Anvil/Relay required (RelayActions.test.ts needs the stack).
// Minimal stub response for wallet_getCapabilities (what RelayActions.prepareCalls
// calls first before emitting wallet_prepareCalls).
const capabilitiesStub = {
  // keyed by hex chainId for base (8453 = 0x2105)
  '0x2105': {
    contracts: {
      accountImplementation: { address: '0x0000000000000000000000000000000000000001' },
      accountProxy: { address: '0x0000000000000000000000000000000000000002' },
      legacyAccountImplementations: [],
      legacyOrchestrators: [],
      orchestrator: { address: '0x0000000000000000000000000000000000000003' },
      simulator: { address: '0x0000000000000000000000000000000000000004' },
    },
    fees: {
      quoteConfig: { rateTtl: 30, ttl: 60 },
      recipient: '0x0000000000000000000000000000000000000005',
      tokens: [],
    },
  },
}

describe('prepareCalls', () => {
  test('behavior: forwards useGasTank into capabilities.meta', async () => {
    let captured: any
    const client = createClient({
      chain: base,
      transport: custom({
        async request({ method, params }) {
          if (method === 'wallet_getCapabilities') {
            return capabilitiesStub
          }
          if (method === 'wallet_prepareCalls') {
            captured = (params as any[])[0]
            throw new Error('__captured__')
          }
          throw new Error(`unexpected method ${method}`)
        },
      }),
    })

    const key = Key.fromSecp256k1({
      privateKey:
        '0x0000000000000000000000000000000000000000000000000000000000000001',
      role: 'admin',
      expiry: 0,
    })
    const account = Account.fromPrivateKey(
      '0x0000000000000000000000000000000000000000000000000000000000000001',
      { keys: [key] },
    )

    await expect(
      RelayActions.prepareCalls(client, {
        account,
        calls: [],
        useGasTank: true,
      } as any),
    ).rejects.toThrow('__captured__')

    expect(captured.capabilities.meta.useGasTank).toBe(true)
  })
})
