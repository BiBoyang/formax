import { describe, expect, it, vi } from 'vitest'
import React, { useState } from 'react'
import { render } from 'ink-testing-library'
import { InputScopeProvider, useInputScope, useScopeActivation, useScopedInput } from './inputScopeContext'

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
        if (key.tab || input === '\t') onReplEvent('tab')
        if (input === '1') onReplEvent('1')
        if (key.escape) onReplEvent('esc')
      })
      useScopedInput('overlay:test', (input, key) => {
        if (key.upArrow) onOverlayEvent('up')
        if (key.downArrow) onOverlayEvent('down')
        if (key.tab || input === '\t') onOverlayEvent('tab')
        if (input === '1') onOverlayEvent('1')
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
    stdin.write('\t') // tab
    await tick()
    stdin.write('1')
    await tick()

    expect(replEvents).toEqual(expect.arrayContaining(['up', 'tab', '1']))
    expect(overlayEvents).toEqual([])

    // Switch to overlay scope.
    stdin.write('O')
    await tick()
    await waitFor(() => scopes.at(-1) === 'overlay:test')

    const replCountBeforeOverlayNav = replEvents.length
    stdin.write('\u001b[B') // down
    await tick()
    stdin.write('\t') // tab
    await tick()
    stdin.write('1')
    await tick()

    expect(overlayEvents).toEqual(expect.arrayContaining(['down', 'tab', '1']))
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
})
