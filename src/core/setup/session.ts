import { createSetupSession as createSetupSessionImpl } from './sessionImpl.js'

export type {
  ConnectionTester,
  SetupSessionState,
  SetupSession,
} from './sessionImpl.js'

export function createSetupSession(...args: Parameters<typeof createSetupSessionImpl>): ReturnType<typeof createSetupSessionImpl> {
  return createSetupSessionImpl(...args)
}
