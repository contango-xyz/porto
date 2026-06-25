import { createClient, custom } from 'viem'
import { base } from 'viem/chains'
import { describe, expect, test } from 'vitest'
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
      accountImplementation: {
        address: '0x0000000000000000000000000000000000000001',
      },
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
  // Drives prepareCalls just far enough to capture the wallet_prepareCalls params,
  // then aborts (no Relay needed). `params` is spread onto the prepareCalls input.
  async function captureCapabilities(params: Record<string, unknown>) {
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
      expiry: 0,
      privateKey:
        '0x0000000000000000000000000000000000000000000000000000000000000001',
      role: 'admin',
    })
    const account = Account.fromPrivateKey(
      '0x0000000000000000000000000000000000000000000000000000000000000001',
      { keys: [key] },
    )

    await expect(
      RelayActions.prepareCalls(client, {
        account,
        calls: [],
        ...params,
      } as any),
    ).rejects.toThrow('__captured__')

    return captured.capabilities
  }
  const captureMeta = async (params: Record<string, unknown>) =>
    (await captureCapabilities(params)).meta

  test('behavior: forwards useGasTank into capabilities.meta', async () => {
    const meta = await captureMeta({ useGasTank: true })
    expect(meta.useGasTank).toBe(true)
  })

  test('behavior: omits useGasTank from capabilities.meta when not provided', async () => {
    const meta = await captureMeta({})
    expect(meta.useGasTank).toBeUndefined()
  })

  test('behavior: forwards bridgePreference into capabilities', async () => {
    const capabilities = await captureCapabilities({ bridgePreference: 'fastest' })
    expect(capabilities.bridgePreference).toBe('fastest')
  })

  test('behavior: omits bridgePreference from capabilities when not provided', async () => {
    const capabilities = await captureCapabilities({})
    expect(capabilities.bridgePreference).toBeUndefined()
  })
})
