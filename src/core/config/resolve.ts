import { resolveRuntimeConfig as resolveRuntimeConfigImpl } from './resolveImpl.js'

export type {
  ConfigSource,
  ResolvedAuth,
  ResolvedConfig,
  ResolveRuntimeConfigInputs,
} from './resolveImpl.js'

export function resolveRuntimeConfig(...args: Parameters<typeof resolveRuntimeConfigImpl>): ReturnType<typeof resolveRuntimeConfigImpl> {
  return resolveRuntimeConfigImpl(...args)
}
