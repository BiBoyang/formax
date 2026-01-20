import React, { createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useInput } from 'ink'

export type InputScopeId = 'repl' | `overlay:${string}` | `wizard:${string}` | `prompt:${string}`

export type InputScopeController = {
  activeScope: InputScopeId
  stack: InputScopeId[]
  push: (scope: InputScopeId) => void
  pop: (scope?: InputScopeId) => void
}

const DEFAULT_SCOPE: InputScopeId = 'repl'

const Ctx = createContext<InputScopeController>({
  activeScope: DEFAULT_SCOPE,
  stack: [DEFAULT_SCOPE],
  push: () => {},
  pop: () => {},
})

export function InputScopeProvider({
  initialScope = 'repl',
  children,
}: {
  initialScope?: InputScopeId
  children: React.ReactNode
}): React.ReactNode {
  const initialRef = useRef<InputScopeId>(initialScope)
  const [stack, setStack] = useState<InputScopeId[]>(() => [initialRef.current])

  const push = useCallback((scope: InputScopeId) => {
    setStack((prev) => {
      const top = prev[prev.length - 1]
      if (top === scope) return prev
      return [...prev, scope]
    })
  }, [])

  const pop = useCallback((scope?: InputScopeId) => {
    setStack((prev) => {
      if (prev.length <= 1) return prev
      if (!scope) return prev.slice(0, -1)
      const idx = prev.lastIndexOf(scope)
      if (idx < 0) return prev
      if (idx === prev.length - 1) return prev.slice(0, -1)
      return [...prev.slice(0, idx), ...prev.slice(idx + 1)]
    })
  }, [])

  const value = useMemo<InputScopeController>(() => {
    const activeScope = stack[stack.length - 1] ?? initialRef.current
    return { activeScope, stack, push, pop }
  }, [pop, push, stack])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useInputScope(): InputScopeController {
  return useContext(Ctx)
}

export function useScopeActivation(scope: InputScopeId, enabled = true): void {
  const { push, pop } = useInputScope()
  useLayoutEffect(() => {
    if (!enabled) return
    push(scope)
    return () => pop(scope)
  }, [enabled, pop, push, scope])
}

export function useScopedInput(
  scope: InputScopeId,
  handler: Parameters<typeof useInput>[0],
  opts?: { enabled?: boolean },
): void {
  const { activeScope } = useInputScope()
  const enabled = opts?.enabled !== false
  useInput(handler, { isActive: enabled && activeScope === scope })
}
