import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { Text } from 'ink'
import { render } from 'ink-testing-library'
import { ReplUiProvider, useReplUi } from './replUiContext.js'

function Probe(): React.ReactNode {
  const replUi = useReplUi()
  return <Text>{replUi ? 'has-ui' : 'no-ui'}</Text>
}

describe('replUiContext', () => {
  it('returns null when no provider is present', () => {
    const { lastFrame } = render(<Probe />)
    expect(lastFrame()).toContain('no-ui')
  })

  it('provides abort handler through context', () => {
    const abort = vi.fn()

    let captured: null | ReturnType<typeof useReplUi> = null
    function Capture(): React.ReactNode {
      captured = useReplUi()
      return <Text>{captured ? 'ready' : 'missing'}</Text>
    }

    const { lastFrame } = render(
      <ReplUiProvider abort={abort}>
        <Capture />
      </ReplUiProvider>,
    )

    expect(lastFrame()).toContain('ready')
    expect(captured).not.toBe(null)
    captured?.abort()
    expect(abort).toHaveBeenCalledTimes(1)
  })
})
