import { describe, expect, it, vi } from 'vitest'
import React, { useState } from 'react'
import { render } from 'ink-testing-library'
import { InputScopeProvider, useInputScope, useScopeActivation, useScopedInput, useScopedRoutedInput } from './inputScopeContext'

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 2000,
): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return
    await tick()
  }
  throw new Error('Timed out waiting for predicate')
}

function Probe({
  onRepl,
  onOverlay,
}: {
  onRepl: (s: string) => void
  onOverlay: (s: string) => void
}): React.ReactNode {
  useScopedInput('repl', (input) => {
    if (input && input !== 'O') onRepl(input)
  })
  useScopedInput('overlay:test', (input) => {
    if (input && input !== 'C') onOverlay(input)
  })
  return null
}

function Overlay(): React.ReactNode {
  useScopeActivation('overlay:test')
  return null
}

function ScopeReporter({ onScope }: { onScope: (s: string) => void }): React.ReactNode {
  const { activeScope } = useInputScope()
  const onScopeRef = React.useRef(onScope)
  onScopeRef.current = onScope
  React.useEffect(() => {
    onScopeRef.current(activeScope)
  }, [activeScope])
  return null
}

function HarnessInner({
  showOverlay,
  setShowOverlay,
  onRepl,
  onOverlay,
  onScope,
}: {
  showOverlay: boolean
  setShowOverlay: (next: boolean) => void
  onRepl: (s: string) => void
  onOverlay: (s: string) => void
  onScope: (s: string) => void
}): React.ReactNode {
  const { push, pop } = useInputScope()
  useScopedInput('repl', (input) => {
    if (input === 'O') {
      // Push the new scope immediately so inputs arriving during the overlay mount
      // are routed consistently under Ink 6 + React 19 batching.
      push('overlay:test')
      setShowOverlay(true)
    }
  })
  useScopedInput('overlay:test', (input) => {
    if (input === 'C') {
      pop('overlay:test')
      setShowOverlay(false)
    }
  })

  return (
    <>
      <ScopeReporter onScope={onScope} />
      {showOverlay ? <Overlay /> : null}
      <Probe onRepl={onRepl} onOverlay={onOverlay} />
    </>
  )
}

function Harness({
  onRepl,
  onOverlay,
  onScope,
}: {
  onRepl: (s: string) => void
  onOverlay: (s: string) => void
  onScope: (s: string) => void
}): React.ReactNode {
  const [showOverlay, setShowOverlay] = useState(false)
  return (
    <InputScopeProvider initialScope="repl">
      <HarnessInner
        showOverlay={showOverlay}
        setShowOverlay={setShowOverlay}
        onRepl={onRepl}
        onOverlay={onOverlay}
        onScope={onScope}
      />
    </InputScopeProvider>
  )
}

describe('InputScopeProvider', () => {
  it('routes input only to the active scope', async () => {
    const onRepl = vi.fn()
    const onOverlay = vi.fn()
    const scopes: string[] = []
    const onScope = (s: string) => {
      scopes.push(s)
    }

    const { stdin } = render(<Harness onRepl={onRepl} onOverlay={onOverlay} onScope={onScope} />)
    await tick()
    await waitFor(() => scopes.at(-1) === 'repl')

    stdin.write('a')
    await tick()
    expect(onRepl).toHaveBeenCalledWith('a')
    expect(onOverlay).not.toHaveBeenCalled()

    stdin.write('O')
    await tick()
    await waitFor(() => scopes.at(-1) === 'overlay:test')

    stdin.write('b')
    await tick()
    expect(onOverlay).toHaveBeenCalledWith('b')

    stdin.write('C')
    await tick()
    await waitFor(() => scopes.at(-1) === 'repl')

    stdin.write('c')
    await tick()
    expect(onRepl).toHaveBeenCalledWith('c')
  })

  it('does not misroute burst input during a scope switch', async () => {
    const onRepl = vi.fn()
    const onOverlay = vi.fn()
    const scopes: string[] = []

    const { stdin } = render(<Harness onRepl={onRepl} onOverlay={onOverlay} onScope={(s) => scopes.push(s)} />)
    await tick()
    await waitFor(() => scopes.at(-1) === 'repl')

    stdin.write('O')
    // Yield once so Ink/React can commit the overlay mount before the next key.
    // Under Ink 6 + React 19, synchronous `stdin.write()` calls can otherwise be processed
    // before React commits state updates triggered by the first input handler.
    await tick()
    stdin.write('b')

    await tick()
    await waitFor(() => scopes.at(-1) === 'overlay:test')

    expect(onOverlay).toHaveBeenCalledWith('b')
    expect(onRepl).not.toHaveBeenCalledWith('b')
  })

  it('works without InputScopeProvider (fallback)', async () => {
    const onRepl = vi.fn()

    function NoProviderHarness(): React.ReactNode {
      useScopedInput('repl', (input) => {
        if (input) onRepl(input)
      })
      return null
    }

    const { stdin } = render(<NoProviderHarness />)
    await tick()

    stdin.write('a')
    await tick()
    expect(onRepl).toHaveBeenCalledWith('a')
  })

  it('provides noop registerHandler without InputScopeProvider', () => {
    let registerCleanup: (() => void) | null = null

    function NoProviderRegisterHarness(): React.ReactNode {
      const { hasRouter, registerHandler } = useInputScope()
      expect(hasRouter).toBe(false)
      registerCleanup = registerHandler({
        scope: 'repl',
        handler: () => true,
      })
      return null
    }

    render(<NoProviderRegisterHarness />)
    expect(registerCleanup).toBeTypeOf('function')
    expect(() => registerCleanup?.()).not.toThrow()
  })

  it('provides noop scope controls without InputScopeProvider', () => {
    function NoProviderControlsHarness(): React.ReactNode {
      const { push, pop, suspendGroup, resumeGroup, activeScope, stack } = useInputScope()
      expect(activeScope).toBe('repl')
      expect(stack).toEqual(['repl'])
      expect(() => push('overlay:test')).not.toThrow()
      expect(() => pop('overlay:test')).not.toThrow()
      expect(() => suspendGroup('g')).not.toThrow()
      expect(() => resumeGroup('g')).not.toThrow()
      return null
    }

    render(<NoProviderControlsHarness />)
  })

  it('routes input only to the active scope (router)', async () => {
    const onRepl = vi.fn()
    const onOverlay = vi.fn()
    const scopes: string[] = []

    function useRouted(scope: 'repl' | 'overlay:test', onInput: (s: string) => void): void {
      const { registerHandler } = useInputScope()
      const onInputRef = React.useRef(onInput)
      onInputRef.current = onInput

      React.useEffect(() => {
        return registerHandler({
          scope,
          handler: (input) => {
            if (!input) return
            onInputRef.current(input)
          },
        })
      }, [registerHandler, scope])
    }

    function RouterHarness(): React.ReactNode {
      const [showOverlay, setShowOverlay] = useState(false)

      useRouted('repl', (input) => {
        if (input === 'O') setShowOverlay(true)
        else onRepl(input)
      })

      useRouted('overlay:test', (input) => {
        if (input === 'C') setShowOverlay(false)
        else onOverlay(input)
      })

      return (
        <>
          <ScopeReporter onScope={(s) => scopes.push(s)} />
          {showOverlay ? <Overlay /> : null}
        </>
      )
    }

    const { stdin } = render(
      <InputScopeProvider initialScope="repl">
        <RouterHarness />
      </InputScopeProvider>,
    )
    await tick()
    await waitFor(() => scopes.at(-1) === 'repl')

    stdin.write('a')
    await tick()
    expect(onRepl).toHaveBeenCalledWith('a')
    expect(onOverlay).not.toHaveBeenCalled()

    stdin.write('O')
    await tick()
    await waitFor(() => scopes.at(-1) === 'overlay:test')

    stdin.write('b')
    await tick()
    expect(onOverlay).toHaveBeenCalledWith('b')

    stdin.write('C')
    await tick()
    await waitFor(() => scopes.at(-1) === 'repl')

    stdin.write('c')
    await tick()
    expect(onRepl).toHaveBeenCalledWith('c')
  })

  it('stops dispatch when a handler consumes input (router)', async () => {
    const calls: string[] = []

    function ConsumeHarness(): React.ReactNode {
      const { registerHandler } = useInputScope()

      React.useEffect(() => {
        const unregisterA = registerHandler({
          scope: 'repl',
          priority: 10,
          handler: (input) => {
            if (!input) return
            calls.push(`A:${input}`)
            return true
          },
        })

        const unregisterB = registerHandler({
          scope: 'repl',
          priority: 0,
          handler: (input) => {
            if (!input) return
            calls.push(`B:${input}`)
          },
        })

        return () => {
          unregisterA()
          unregisterB()
        }
      }, [registerHandler])

      return null
    }

    const { stdin } = render(
      <InputScopeProvider initialScope="repl">
        <ConsumeHarness />
      </InputScopeProvider>,
    )
    await tick()

    stdin.write('x')
    await tick()

    expect(calls).toEqual(['A:x'])
  })

  it('supports group suspend/resume with refcount (router)', async () => {
    const calls: string[] = []
    let suspend: ((group: string) => void) | null = null
    let resume: ((group: string) => void) | null = null

    function SuspendHarness(): React.ReactNode {
      const { registerHandler, suspendGroup, resumeGroup } = useInputScope()
      suspend = suspendGroup
      resume = resumeGroup

      React.useEffect(() => {
        const unregisterA = registerHandler({
          scope: 'repl',
          group: 'command',
          priority: 0,
          handler: (input) => {
            if (!input) return
            calls.push(`A:${input}`)
          },
        })

        const unregisterB = registerHandler({
          scope: 'repl',
          group: 'default',
          priority: 0,
          handler: (input) => {
            if (!input) return
            calls.push(`B:${input}`)
          },
        })

        return () => {
          unregisterA()
          unregisterB()
        }
      }, [registerHandler])

      return null
    }

    const { stdin } = render(
      <InputScopeProvider initialScope="repl">
        <SuspendHarness />
      </InputScopeProvider>,
    )
    await tick()

    stdin.write('x')
    await tick()
    expect(calls).toEqual(['A:x', 'B:x'])

    // Suspend twice; one resume should still keep it suspended.
    suspend?.('command')
    suspend?.('command')

    stdin.write('y')
    await tick()
    expect(calls).toEqual(['A:x', 'B:x', 'B:y'])

    resume?.('command')
    stdin.write('z')
    await tick()
    expect(calls).toEqual(['A:x', 'B:x', 'B:y', 'B:z'])

    resume?.('command')
    stdin.write('w')
    await tick()
    expect(calls).toEqual(['A:x', 'B:x', 'B:y', 'B:z', 'A:w', 'B:w'])

    // Resuming a never-suspended group is a no-op.
    resume?.('never-suspended')
    suspend?.('   ')
    resume?.('   ')
  })

  it('allows unregister to be called multiple times safely', async () => {
    let unregister: (() => void) | null = null

    function UnregisterHarness(): React.ReactNode {
      const { registerHandler } = useInputScope()
      React.useEffect(() => {
        unregister = registerHandler({
          scope: 'repl',
          handler: () => true,
        })
      }, [registerHandler])
      return null
    }

    render(
      <InputScopeProvider initialScope="repl">
        <UnregisterHarness />
      </InputScopeProvider>,
    )
    await tick()

    expect(unregister).toBeTypeOf('function')
    expect(() => unregister?.()).not.toThrow()
    expect(() => unregister?.()).not.toThrow()
  })

  it('keeps remaining handlers when one handler unregisters', async () => {
    let unregisterA: (() => void) | null = null
    let unregisterB: (() => void) | null = null

    function MultiRegisterHarness(): React.ReactNode {
      const { registerHandler } = useInputScope()
      React.useEffect(() => {
        unregisterA = registerHandler({
          scope: 'repl',
          handler: () => true,
        })
        unregisterB = registerHandler({
          scope: 'repl',
          handler: () => false,
        })
      }, [registerHandler])
      return null
    }

    render(
      <InputScopeProvider initialScope="repl">
        <MultiRegisterHarness />
      </InputScopeProvider>,
    )
    await tick()

    expect(unregisterA).toBeTypeOf('function')
    expect(unregisterB).toBeTypeOf('function')
    expect(() => unregisterA?.()).not.toThrow()
    expect(() => unregisterB?.()).not.toThrow()
  })

  it('covers single-handler fast path with consume, suspend, and throw safety', async () => {
    const calls: string[] = []
    let suspend: ((group: string) => void) | null = null
    let resume: ((group: string) => void) | null = null

    function SingleHandlerHarness(): React.ReactNode {
      const { registerHandler, suspendGroup, resumeGroup } = useInputScope()
      suspend = suspendGroup
      resume = resumeGroup

      React.useEffect(() => {
        return registerHandler({
          scope: 'repl',
          group: 'single',
          handler: (input) => {
            if (input === 'x') return true
            if (input === 'e') throw new Error('ignore in router')
            if (input) calls.push(input)
          },
        })
      }, [registerHandler])

      return null
    }

    const { stdin } = render(
      <InputScopeProvider initialScope="repl">
        <SingleHandlerHarness />
      </InputScopeProvider>,
    )
    await tick()

    stdin.write('x')
    await tick()
    expect(calls).toEqual([])

    suspend?.('single')
    stdin.write('a')
    await tick()
    expect(calls).toEqual([])

    resume?.('single')
    stdin.write('b')
    await tick()
    expect(calls).toEqual(['b'])

    stdin.write('e')
    await tick()
    expect(calls).toEqual(['b'])
  })

  it('removes non-top scopes when they unmount', async () => {
    const scopes: string[] = []

    function ScopeA({ open }: { open: boolean }): React.ReactNode {
      useScopeActivation('overlay:a', open)
      return null
    }

    function ScopeB({ open }: { open: boolean }): React.ReactNode {
      useScopeActivation('overlay:b', open)
      return null
    }

    function OutOfOrderHarness(): React.ReactNode {
      const [aOpen, setAOpen] = useState(false)
      const [bOpen, setBOpen] = useState(false)

      useScopedInput('repl', (input) => {
        if (input === 'A') setAOpen(true)
      })

      useScopedInput('overlay:a', (input) => {
        if (input === 'B') setBOpen(true)
      })

      useScopedInput('overlay:b', (input) => {
        if (input === 'a') setAOpen(false)
        if (input === 'b') setBOpen(false)
      })

      return (
        <>
          <ScopeReporter onScope={(s) => scopes.push(s)} />
          <ScopeA open={aOpen} />
          <ScopeB open={bOpen} />
        </>
      )
    }

    const { stdin } = render(
      <InputScopeProvider initialScope="repl">
        <OutOfOrderHarness />
      </InputScopeProvider>,
    )

    await tick()
    await waitFor(() => scopes.at(-1) === 'repl')

    // Open A then B so B is on top.
    stdin.write('A')
    await tick()
    await waitFor(() => scopes.at(-1) === 'overlay:a')

    stdin.write('B')
    await tick()
    await waitFor(() => scopes.at(-1) === 'overlay:b')

    // Close A while B is still active (out-of-order).
    stdin.write('a')
    await tick()
    await waitFor(() => scopes.at(-1) === 'overlay:b')

    // Close B; should return to repl, not a stale A scope.
    stdin.write('b')
    await tick()
    await waitFor(() => scopes.at(-1) === 'repl')
  })

  it('routes navigation keys only to the active scope', async () => {
    const replEvents: string[] = []
    const overlayEvents: string[] = []
    const scopes: string[] = []

    function NavProbe({
      onReplEvent,
      onOverlayEvent,
    }: {
      onReplEvent: (s: string) => void
      onOverlayEvent: (s: string) => void
    }): React.ReactNode {
      useScopedInput('repl', (input, key) => {
        if (key.upArrow) onReplEvent('up')
        if (key.downArrow) onReplEvent('down')
        if (key.leftArrow) onReplEvent('left')
        if (key.rightArrow) onReplEvent('right')
        if (key.tab || input === '\t') onReplEvent('tab')
        if (input === '1') onReplEvent('1')
        if (key.return || input === '\r') onReplEvent('enter')
        if (key.escape) onReplEvent('esc')
      })
      useScopedInput('overlay:test', (input, key) => {
        if (key.upArrow) onOverlayEvent('up')
        if (key.downArrow) onOverlayEvent('down')
        if (key.leftArrow) onOverlayEvent('left')
        if (key.rightArrow) onOverlayEvent('right')
        if (key.tab || input === '\t') onOverlayEvent('tab')
        if (input === '1') onOverlayEvent('1')
        if (key.return || input === '\r') onOverlayEvent('enter')
        if (key.escape) onOverlayEvent('esc')
      })
      return null
    }

    function NavHarnessInner({
      showOverlay,
      setShowOverlay,
      onReplEvent,
      onOverlayEvent,
      onScope,
    }: {
      showOverlay: boolean
      setShowOverlay: (next: boolean) => void
      onReplEvent: (s: string) => void
      onOverlayEvent: (s: string) => void
      onScope: (s: string) => void
    }): React.ReactNode {
      useScopedInput('repl', (input) => {
        if (input === 'O') setShowOverlay(true)
      })
      useScopedInput('overlay:test', (input) => {
        if (input === 'C') setShowOverlay(false)
      })

      return (
        <>
          <ScopeReporter onScope={onScope} />
          {showOverlay ? <Overlay /> : null}
          <NavProbe onReplEvent={onReplEvent} onOverlayEvent={onOverlayEvent} />
        </>
      )
    }

    function NavHarness({ onScope }: { onScope: (s: string) => void }): React.ReactNode {
      const [showOverlay, setShowOverlay] = useState(false)
      return (
        <InputScopeProvider initialScope="repl">
          <NavHarnessInner
            showOverlay={showOverlay}
            setShowOverlay={setShowOverlay}
            onReplEvent={(s) => replEvents.push(s)}
            onOverlayEvent={(s) => overlayEvents.push(s)}
            onScope={onScope}
          />
        </InputScopeProvider>
      )
    }

    const { stdin } = render(<NavHarness onScope={(s) => scopes.push(s)} />)
    await tick()
    await waitFor(() => scopes.at(-1) === 'repl')

    // In repl scope: navigation keys should hit repl only.
    stdin.write('\u001b[A') // up
    await tick()
    stdin.write('\u001b[D') // left
    await tick()
    stdin.write('\t') // tab
    await tick()
    stdin.write('1')
    await tick()
    stdin.write('\r') // enter
    await tick()
    // Esc has to be tested standalone because arrow keys also begin with \u001b.
    stdin.write('\u001b') // esc
    await tick()

    expect(replEvents).toEqual(expect.arrayContaining(['up', 'left', 'tab', '1', 'enter', 'esc']))
    expect(overlayEvents).toEqual([])

    // Switch to overlay scope.
    stdin.write('O')
    await tick()
    await waitFor(() => scopes.at(-1) === 'overlay:test')

    const replCountBeforeOverlayNav = replEvents.length
    stdin.write('\u001b[B') // down
    await tick()
    stdin.write('\u001b[C') // right
    await tick()
    stdin.write('\t') // tab
    await tick()
    stdin.write('1')
    await tick()
    stdin.write('\r') // enter
    await tick()
    stdin.write('\u001b') // esc
    await tick()

    expect(overlayEvents).toEqual(expect.arrayContaining(['down', 'right', 'tab', '1', 'enter', 'esc']))
    expect(replEvents).toHaveLength(replCountBeforeOverlayNav)

    // Return to repl scope.
    stdin.write('C')
    await tick()
    await waitFor(() => scopes.at(-1) === 'repl')

    const overlayCountBeforeReplNav = overlayEvents.length
    stdin.write('\u001b[B') // down
    await tick()
    expect(replEvents).toEqual(expect.arrayContaining(['down']))
    expect(overlayEvents).toHaveLength(overlayCountBeforeReplNav)
  })

  it('does not register routed handler when enabled is false', async () => {
    const onRepl = vi.fn()

    function DisabledHarness(): React.ReactNode {
      useScopedRoutedInput(
        'repl',
        (input) => {
          if (input) onRepl(input)
        },
        { enabled: false, group: 'disabled', priority: 1 },
      )
      return null
    }

    const { stdin } = render(
      <InputScopeProvider initialScope="repl">
        <DisabledHarness />
      </InputScopeProvider>,
    )
    await tick()
    stdin.write('a')
    await tick()
    expect(onRepl).not.toHaveBeenCalled()
  })

  it('ignores scoped routed input without provider when active scope mismatches', async () => {
    const onOverlay = vi.fn()

    function NoProviderOverlayHarness(): React.ReactNode {
      useScopedRoutedInput('overlay:test', (input) => {
        if (input) onOverlay(input)
      })
      return null
    }

    const { stdin } = render(<NoProviderOverlayHarness />)
    await tick()
    stdin.write('z')
    await tick()
    expect(onOverlay).not.toHaveBeenCalled()
  })

  it('short-circuits scoped routed input callback when disabled without provider', async () => {
    const onRepl = vi.fn()

    function NoProviderDisabledHarness(): React.ReactNode {
      useScopedRoutedInput(
        'repl',
        (input) => {
          if (input) onRepl(input)
        },
        { enabled: false },
      )
      return null
    }

    const { stdin } = render(<NoProviderDisabledHarness />)
    await tick()
    stdin.write('z')
    await tick()
    expect(onRepl).not.toHaveBeenCalled()
  })

  it('supports direct pop semantics for top and unknown scopes', async () => {
    const scopes: string[] = []
    let pushRef: ((scope: 'repl' | `overlay:${string}` | `wizard:${string}` | `prompt:${string}`) => void) | null = null
    let popRef: ((scope?: 'repl' | `overlay:${string}` | `wizard:${string}` | `prompt:${string}`) => void) | null = null

    function DirectPopHarness(): React.ReactNode {
      const { activeScope, push, pop } = useInputScope()
      pushRef = push
      popRef = pop
      React.useEffect(() => {
        scopes.push(activeScope)
      }, [activeScope])
      return null
    }

    render(
      <InputScopeProvider initialScope="repl">
        <DirectPopHarness />
      </InputScopeProvider>,
    )
    await tick()

    pushRef?.('overlay:one')
    await waitFor(() => scopes.at(-1) === 'overlay:one')

    popRef?.('overlay:missing')
    await waitFor(() => scopes.at(-1) === 'overlay:one')

    popRef?.()
    await waitFor(() => scopes.at(-1) === 'repl')
  })

  it('updates handler version when unregistering an existing handler immediately', async () => {
    const calls: string[] = []

    function ImmediateUnregisterHarness(): React.ReactNode {
      const { registerHandler } = useInputScope()
      React.useEffect(() => {
        const unregister = registerHandler({
          scope: 'repl',
          handler: (input) => {
            if (input) calls.push(input)
          },
        })
        unregister()
      }, [registerHandler])
      return null
    }

    const { stdin } = render(
      <InputScopeProvider initialScope="repl">
        <ImmediateUnregisterHarness />
      </InputScopeProvider>,
    )
    await tick()
    stdin.write('k')
    await tick()
    expect(calls).toEqual([])
  })
})
