import * as Dialog from '../../Dialog.js'
import { isReactNative } from '../../react-native/utils.js'
import * as Mode from '../mode.js'
import { dialog } from './dialog.js'

const createStubFallback = (): Mode.Mode => {
  const throwNotAvailable = (): never => {
    throw new Error("Mode.reactNative() fallback not available.")
  }
  return {
    actions: new Proxy({} as Mode.Mode["actions"], {
      get: () => throwNotAvailable,
    }),
    config: undefined as Mode.Mode["config"],
    name: "stub",
    setup: () => () => {},
  }
}

export function reactNative(parameters: reactNative.Parameters = {}) {
  if (!isReactNative())
    return parameters.fallback ?? createStubFallback()

  const { redirectUri, requestOptions, ...baseParameters } = parameters

  return Mode.from({
    ...dialog({
      ...baseParameters,
      renderer: Dialog.authSession({ redirectUri, requestOptions }),
    }),
    name: 'reactNative',
  })
}

export declare namespace reactNative {
  export type Parameters =
    | (Omit<dialog.Parameters, 'renderer'> & Dialog.authSession.Options)
    | undefined
}
