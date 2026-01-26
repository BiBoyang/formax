import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useInput } from 'ink'

export type InputScopeId = 'repl' | `overlay:${string}` | `wizard:${string}` | `prompt:${string}`

type InkInputHandler = Parameters<typeof useInput>[0]
type InkInput = Parameters<InkInputHandler>[0]
type InkKey = Parameters<InkInputHandler>[1]

export type RoutedInputHandler = (input: InkInput, key: InkKey) => boolean | void

type RegisteredHandler = {
  id: number
  scope: InputScopeId
  group: string
  priority: number
  order: number
  handler: RoutedInputHandler
}

export type InputScopeController = {
  activeScope: InputScopeId
  stack: InputScopeId[]
  push: (scope: InputScopeId) => void
  pop: (scope?: InputScopeId) => void
  registerHandler: (opts: {
    scope: InputScopeId
    group?: string
    priority?: number
    handler: RoutedInputHandler
  }) => () => void
}

const DEFAULT_SCOPE: InputScopeId = 'repl'

const Ctx = createContext<InputScopeController>({
  activeScope: DEFAULT_SCOPE,
  stack: [DEFAULT_SCOPE],
  push: () => {},
  pop: () => {},
  registerHandler: () => () => {},
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
  const handlersRef = useRef<Map<InputScopeId, RegisteredHandler[]>>(new Map())
  const nextHandlerIdRef = useRef(1)
  const nextOrderRef = useRef(1)

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

  const registerHandler = useCallback<InputScopeController['registerHandler']>((opts) => {
    const id = nextHandlerIdRef.current++
    const record: RegisteredHandler = {
      id,
      scope: opts.scope,
      group: opts.group ?? 'default',
      priority: opts.priority ?? 0,
      order: nextOrderRef.current++,
      handler: opts.handler,
    }

    const list = handlersRef.current.get(record.scope)
    if (list) list.push(record)
    else handlersRef.current.set(record.scope, [record])

    return () => {
      const cur = handlersRef.current.get(record.scope)
      if (!cur) return
      const next = cur.filter((h) => h.id !== record.id)
      if (next.length === 0) handlersRef.current.delete(record.scope)
      else handlersRef.current.set(record.scope, next)
    }
  }, [])

  const value = useMemo<InputScopeController>(() => {
    const activeScope = stack[stack.length - 1] ?? initialRef.current
    return { activeScope, stack, push, pop, registerHandler }
  }, [pop, push, registerHandler, stack])

  const activeScopeRef = useRef<InputScopeId>(value.activeScope)
  useEffect(() => {
    activeScopeRef.current = value.activeScope
  }, [value.activeScope])

  useInput(
    (input, key) => {
      const activeScope = activeScopeRef.current
      const handlers = handlersRef.current.get(activeScope)
      if (!handlers || handlers.length === 0) return

      const ordered = [...handlers].sort((a, b) => b.priority - a.priority || a.order - b.order)
      for (const h of ordered) {
        try {
          const consumed = h.handler(input, key) === true
          if (consumed) return
        } catch {
        }
      }
    },
    { isActive: true },
  )

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

  const handlerRef = useRef(handler)
  useEffect(() => {
    handlerRef.current = handler
  }, [handler])

  useInput(
    (input, key) => {
      if (!enabled) return
      if (activeScope !== scope) return
      handlerRef.current(input, key)
    },
    { isActive: true },
  )
}
