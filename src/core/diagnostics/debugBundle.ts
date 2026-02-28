import { createDebugBundle as createDebugBundleImpl } from './debugBundleImpl.js'

export type {
  DebugBundleManifestV1,
  DebugBundleResult,
} from './debugBundleImpl.js'

export function createDebugBundle(...args: Parameters<typeof createDebugBundleImpl>): ReturnType<typeof createDebugBundleImpl> {
  return createDebugBundleImpl(...args)
}
