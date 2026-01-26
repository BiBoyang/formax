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
  suspendGroup: (group: string) => void
  resumeGroup: (group: string) => void
  hasRouter: boolean
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
  suspendGroup: () => {},
  resumeGroup: () => {},
  hasRouter: false,
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
  const suspendedGroupsRef = useRef<Map<string, number>>(new Map())
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

  const suspendGroup = useCallback<InputScopeController['suspendGroup']>((group) => {
    const key = group.trim()
    if (!key) return
    const cur = suspendedGroupsRef.current.get(key) ?? 0
    suspendedGroupsRef.current.set(key, cur + 1)
  }, [])

  const resumeGroup = useCallback<InputScopeController['resumeGroup']>((group) => {
    const key = group.trim()
    if (!key) return
    const cur = suspendedGroupsRef.current.get(key) ?? 0
    const next = cur - 1
    if (next <= 0) suspendedGroupsRef.current.delete(key)
    else suspendedGroupsRef.current.set(key, next)
  }, [])

  const value = useMemo<InputScopeController>(() => {
    const activeScope = stack[stack.length - 1] ?? initialRef.current
    return { activeScope, stack, push, pop, suspendGroup, resumeGroup, hasRouter: true, registerHandler }
  }, [pop, push, registerHandler, resumeGroup, stack, suspendGroup])

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
        if ((suspendedGroupsRef.current.get(h.group) ?? 0) > 0) continue
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

export function useScopedRoutedInput(
  scope: InputScopeId,
  handler: RoutedInputHandler,
  opts?: { enabled?: boolean; group?: string; priority?: number },
): void {
  const { activeScope, hasRouter, registerHandler } = useInputScope()
  const enabled = opts?.enabled !== false

  const handlerRef = useRef(handler)
  useEffect(() => {
    handlerRef.current = handler
  }, [handler])

  useEffect(() => {
    if (!hasRouter) return
    if (!enabled) return
    return registerHandler({
      scope,
      group: opts?.group,
      priority: opts?.priority,
      handler: (input, key) => handlerRef.current(input, key) === true,
    })
  }, [enabled, hasRouter, opts?.group, opts?.priority, registerHandler, scope])

  useInput(
    (input, key) => {
      if (!enabled) return
      if (activeScope !== scope) return
      handlerRef.current(input, key)
    },
    { isActive: !hasRouter },
  )
}

export function useScopedInput(
  scope: InputScopeId,
  handler: Parameters<typeof useInput>[0],
  opts?: { enabled?: boolean },
): void {
  const handlerRef = useRef(handler)
  useEffect(() => {
    handlerRef.current = handler
  }, [handler])

  useScopedRoutedInput(
    scope,
    (input, key) => {
      handlerRef.current(input, key)
      return false
    },
    opts,
  )
}
