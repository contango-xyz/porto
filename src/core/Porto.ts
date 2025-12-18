import type * as Mipd from 'mipd'
import type * as Address from 'ox/Address'
import type * as Hex from 'ox/Hex'
import type * as RpcRequest from 'ox/RpcRequest'
import type * as RpcResponse from 'ox/RpcResponse'
import { http, type Transport } from 'viem'
import { createStore, type StoreApi } from 'zustand/vanilla'
import type * as Account from '../viem/Account.js'
import * as Chains from './Chains.js'
import { hostUrls } from './Dialog.js'
import type * as Mode from './internal/mode.js'
import { dialog } from './internal/modes/dialog.js'
import type * as internal from './internal/porto.js'
import * as Provider from './internal/provider.js'
import type * as Token from './internal/schema/token.js'
import type * as Siwe from './internal/siwe.js'
import type { ExactPartial, OneOf } from './internal/types.js'
import * as Utils from './internal/utils.js'
import * as Storage from './Storage.js'
import { relayUrls } from './Transport.js'

const browser = typeof window !== 'undefined' && typeof document !== 'undefined'

type SubscribeWithSelectorOptions<slice> = {
  equalityFn?: ((a: slice, b: slice) => boolean) | undefined
  fireImmediately?: boolean | undefined
}

type PersistApi = {
  hasHydrated: () => boolean
  onFinishHydration: (listener: () => void) => () => void
  rehydrate: () => Promise<void>
}

type PersistOptions<state> = {
  merge?: ((persistedState: unknown, currentState: state) => state) | undefined
  name: string
  partialize?: ((state: state) => unknown) | undefined
  storage: Storage.Storage
  version?: number | undefined
}

type SetState<state> = (
  partial:
    | state
    | Partial<state>
    | ((state: state) => state | Partial<state>),
  replace?: boolean | undefined,
  action?: unknown,
) => void

type StoreCreator<state> = (
  set: SetState<state>,
  get: () => state,
  api: StoreApi<state>,
) => state

const subscribeWithSelector = <state>(
  fn: StoreCreator<state>,
): StoreCreator<state> => {
  return (set, get, api) => {
    const originalSubscribe = api.subscribe
    api.subscribe = ((selector: unknown, optListener?: unknown, options?: unknown) => {
      if (typeof optListener !== 'function') {
        return originalSubscribe(
          selector as (state: state, prevState: state) => void,
        )
      }

      const equalityFn =
        (options as SubscribeWithSelectorOptions<unknown> | undefined)?.equalityFn ??
        Object.is
      let currentSlice = (selector as (state: state) => unknown)(api.getState())
      const listener = (nextState: state) => {
        const nextSlice = (selector as (state: state) => unknown)(nextState)
        if (!equalityFn(currentSlice, nextSlice)) {
          const previousSlice = currentSlice
          currentSlice = nextSlice
          ;(optListener as (slice: unknown, previousSlice: unknown) => void)(
            currentSlice,
            previousSlice,
          )
        }
      }

      if ((options as SubscribeWithSelectorOptions<unknown> | undefined)?.fireImmediately) {
        ;(optListener as (slice: unknown, previousSlice: unknown) => void)(
          currentSlice,
          currentSlice,
        )
      }

      return originalSubscribe(listener)
    }) as StoreApi<state>['subscribe']

    return fn(set, get, api)
  }
}

const persist = <state>(
  fn: StoreCreator<state>,
  options: PersistOptions<state>,
): StoreCreator<state> => {
  return (set, get, api) => {
    let hydrated = false
    const finishHydrationListeners = new Set<() => void>()

    const hasHydrated = () => hydrated
    const onFinishHydration = (listener: () => void) => {
      finishHydrationListeners.add(listener)
      return () => {
        finishHydrationListeners.delete(listener)
      }
    }

    const setItem = async () => {
      const partialized = options.partialize
        ? options.partialize(api.getState())
        : api.getState()
      await options.storage.setItem(options.name, {
        state: partialized,
        version: options.version ?? 0,
      })
    }

    const rehydrate = async () => {
      const persisted = await options.storage.getItem<unknown>(options.name)
      if (persisted && typeof persisted === 'object') {
        const persistedState =
          (persisted as { state?: unknown }).state ?? (persisted as unknown)
        const merged = options.merge
          ? options.merge(persistedState, api.getState())
          : ({ ...api.getState(), ...(persistedState as object) } as state)
        set(merged, true)
      }

      hydrated = true
      for (const listener of finishHydrationListeners) listener()
    }

    ;(api as StoreApi<state> & { persist: PersistApi }).persist = {
      hasHydrated,
      onFinishHydration,
      rehydrate,
    }

    const initialState = fn((partial, replace) => {
      set(partial, replace)
      void setItem()
    }, get, api)

    void rehydrate()
    return initialState
  }
}

export const defaultConfig = {
  announceProvider: true,
  chains: Chains.all,
  get mode() {
    if (browser) return dialog({ host: hostUrls.prod })
    throw new Error(
      'Porto: mode is required in non-browser environments. ' +
        'Please provide mode explicitly, e.g., Porto.create({ mode: Mode.relay() }).',
    )
  },
  relay: http(relayUrls.prod.http),
  storage:
    browser && typeof indexedDB !== 'undefined'
      ? Storage.idb()
      : Storage.memory(),
  storageKey: 'porto.store',
} as const satisfies ExactPartial<Config>

/**
 * Instantiates an Porto instance.
 *
 * @example
 * ```ts twoslash
 * import { Porto } from 'porto'
 *
 * const porto = Porto.create()
 *
 * const blockNumber = await porto.provider.request({ method: 'eth_blockNumber' })
 * ```
 */
export function create<
  const chains extends readonly [Chains.Chain, ...Chains.Chain[]],
>(parameters?: ExactPartial<Config<chains>> | undefined): Porto<chains>
export function create(
  parameters: ExactPartial<Config> | undefined = {},
): Porto {
  const chains = parameters.chains ?? defaultConfig.chains
  const transports = Object.fromEntries(
    chains!.map((chain) => [
      chain.id,
      parameters.transports?.[chain.id] ?? http(),
    ]),
  )

  const config = {
    announceProvider:
      parameters.announceProvider ?? defaultConfig.announceProvider,
    authUrl: parameters.authUrl,
    chains,
    feeToken: parameters.feeToken,
    merchantUrl: parameters.merchantUrl,
    mode: parameters.mode ?? defaultConfig.mode,
    relay: parameters.relay ?? defaultConfig.relay,
    storage: parameters.storage ?? defaultConfig.storage,
    storageKey: parameters.storageKey ?? defaultConfig.storageKey,
    transports,
  } satisfies Config

  const store = createStore(
    subscribeWithSelector(
      persist<State>(
        (_) => ({
          accounts: [],
          chainIds: config.chains.map((chain) => chain.id) as [
            number,
            ...number[],
          ],
          feeToken: config.feeToken,
          requestQueue: [],
        }),
        {
          merge(p, currentState) {
            const persistedState = p as State
            const currentChainId =
              config.chains.find(
                (chain) => chain.id === persistedState.chainIds[0],
              )?.id ?? config.chains[0].id
            const chainIds = [
              currentChainId,
              ...config.chains
                .map((chain) => chain.id)
                .filter((id) => id !== currentChainId),
            ] as const
            return {
              ...currentState,
              ...persistedState,
              chainIds,
            }
          },
          name: config.storageKey,
          partialize: (state) =>
            ({
              accounts: state.accounts.map((account) =>
                // omit non-serializable properties (e.g. functions).
                Utils.normalizeValue(account),
              ),
              chainIds: state.chainIds,
            }) as unknown as State,
          storage: config.storage,
          version: 5,
        },
      ),
    ) as unknown as (set: unknown, get: unknown, api: unknown) => State,
  ) as unknown as Store

  let mode = config.mode

  const internal = {
    config,
    getMode() {
      return mode
    },
    id: Utils.uuidv4(),
    setMode(i) {
      destroy?.()
      mode = i
      destroy = i.setup({
        internal,
      })
      return destroy
    },
    store,
  } satisfies internal.Internal

  const provider = Provider.from(internal)

  let destroy =
    mode !== null
      ? mode.setup({
          internal,
        })
      : () => {}

  return {
    _internal: internal,
    config,
    destroy() {
      destroy()
      provider._internal.destroy()
    },
    provider,
  }
}

export type Config<
  chains extends readonly [Chains.Chain, ...Chains.Chain[]] = readonly [
    Chains.Chain,
    ...Chains.Chain[],
  ],
> = {
  /**
   * Whether to announce the provider via EIP-6963.
   * Also accepts EIP-6963 provider info.
   * @default true
   */
  announceProvider: boolean | Partial<Mipd.EIP6963ProviderInfo>
  /**
   * API URL(s) to use for offchain SIWE authentication.
   */
  authUrl?: string | Siwe.AuthUrl | undefined
  /**
   * List of supported chains.
   */
  chains: chains
  /**
   * Token to use to pay for fees.
   * @default 'native'
   */
  feeToken?: State['feeToken'] | undefined
  /**
   * Mode to use.
   * @default Mode.dialog()
   */
  mode: Mode.Mode | null
  /**
   * URL to use for merchant server.
   */
  merchantUrl?: string | undefined
  /**
   * Relay RPC Transport override.
   */
  relay: Transport
  /**
   * Storage to use.
   * @default Storage.idb()
   */
  storage: Storage.Storage
  /**
   * Key to use for store.
   */
  storageKey?: string | undefined
  /**
   * Public RPC Transport overrides to use for each chain.
   */
  transports: Record<chains[number]['id'], Transport>
}

export type Porto<
  chains extends readonly [Chains.Chain, ...Chains.Chain[]] = readonly [
    Chains.Chain,
    ...Chains.Chain[],
  ],
> = {
  config: Config<chains>
  destroy: () => void
  provider: Provider.Provider
  /**
   * Not part of versioned API, proceed with caution.
   * @deprecated
   */
  _internal: internal.Internal<chains>
}

export type State<
  chains extends readonly [Chains.Chain, ...Chains.Chain[]] = readonly [
    Chains.Chain,
    ...Chains.Chain[],
  ],
> = {
  accounts: readonly Account.Account[]
  chainIds: readonly [chains[number]['id'], ...chains[number]['id'][]]
  feeToken: Token.Symbol | undefined
  requestQueue: readonly QueuedRequest[]
}

export type Store<
  chains extends readonly [Chains.Chain, ...Chains.Chain[]] = readonly [
    Chains.Chain,
    ...Chains.Chain[],
  ],
> = Omit<StoreApi<State<chains>>, 'subscribe'> & {
  persist: PersistApi
  subscribe: {
    (listener: (state: State<chains>, prevState: State<chains>) => void): () => void
    <slice>(
      selector: (state: State<chains>) => slice,
      listener: (slice: slice, previousSlice: slice) => void,
      options?: SubscribeWithSelectorOptions<slice> | undefined,
    ): () => void
  }
}

export type QueuedRequest<result = unknown> = {
  /** Account to assert the request for, and sync if neccessary. */
  account:
    | {
        /** Address of the account. */
        address: Address.Address
        /** Active key of the account. */
        key?:
          | {
              /** Credential ID. May be `undefined` when the key is not a WebAuthn credential. */
              credentialId?: string | undefined
              /** Public key */
              publicKey: Hex.Hex
            }
          | undefined
      }
    | undefined
  request: RpcRequest.RpcRequest & { _internal?: unknown }
} & OneOf<
  | {
      status: 'pending'
    }
  | {
      result: result
      status: 'success'
    }
  | {
      error: RpcResponse.ErrorObject
      status: 'error'
    }
>
