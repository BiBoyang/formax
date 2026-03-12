import React, { createContext, useContext } from 'react'

export type SubagentPresentationCatalog = {
  colorByName: ReadonlyMap<string, string>
}

const defaultCatalog: SubagentPresentationCatalog = {
  colorByName: new Map<string, string>(),
}

const SubagentPresentationContext = createContext<SubagentPresentationCatalog>(defaultCatalog)

export function SubagentPresentationProvider(args: {
  catalog: SubagentPresentationCatalog
  children: React.ReactNode
}): React.ReactNode {
  return <SubagentPresentationContext.Provider value={args.catalog}>{args.children}</SubagentPresentationContext.Provider>
}

export function useSubagentPresentationCatalog(): SubagentPresentationCatalog {
  return useContext(SubagentPresentationContext)
}
