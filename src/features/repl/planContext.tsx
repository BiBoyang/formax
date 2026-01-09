import React, { createContext, useContext } from 'react'
import type { PlanSessionManager } from './planSession'

const PlanCtx = createContext<PlanSessionManager | null>(null)

export function PlanProvider({
  planSession,
  children,
}: {
  planSession: PlanSessionManager
  children: React.ReactNode
}): React.ReactNode {
  return <PlanCtx.Provider value={planSession}>{children}</PlanCtx.Provider>
}

export function usePlanSession(): PlanSessionManager | null {
  return useContext(PlanCtx)
}

