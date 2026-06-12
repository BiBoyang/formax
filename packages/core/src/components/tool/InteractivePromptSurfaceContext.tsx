import React, { createContext, useContext } from 'react'

type InteractivePromptSurface = 'legacy-inline' | 'bottom-slot'

const InteractivePromptSurfaceCtx = createContext<InteractivePromptSurface>('legacy-inline')

export function InteractivePromptSurfaceProvider({
  surface,
  children,
}: {
  surface: InteractivePromptSurface
  children: React.ReactNode
}): React.ReactNode {
  return <InteractivePromptSurfaceCtx.Provider value={surface}>{children}</InteractivePromptSurfaceCtx.Provider>
}

export function useInlineInteractivePromptAllowed(): boolean {
  return useContext(InteractivePromptSurfaceCtx) === 'legacy-inline'
}
