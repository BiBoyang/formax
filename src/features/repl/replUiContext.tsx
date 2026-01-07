import React, { createContext, useContext } from 'react'

export type ReplUi = {
  abort: () => void
}

const ReplUiCtx = createContext<ReplUi | null>(null)

export function ReplUiProvider({
  abort,
  children,
}: {
  abort: () => void
  children: React.ReactNode
}): React.ReactNode {
  return <ReplUiCtx.Provider value={{ abort }}>{children}</ReplUiCtx.Provider>
}

export function useReplUi(): ReplUi | null {
  return useContext(ReplUiCtx)
}

