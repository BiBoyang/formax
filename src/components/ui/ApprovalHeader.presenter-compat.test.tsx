import { beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import { ApprovalHeader as ServiceApprovalHeader } from './ApprovalHeader'

const mocks = vi.hoisted(() => ({
  columns: 100 as number | undefined,
}))

vi.mock('ink', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ink')>()
  return {
    ...actual,
    useStdout: () => ({ stdout: { columns: mocks.columns } }),
  }
})

function renderFrame(node: React.ReactElement): string {
  const view = render(node)
  const frame = view.lastFrame() ?? ''
  view.unmount()
  return frame
}

describe('ApprovalHeader presenter compatibility', () => {
  beforeEach(() => {
    mocks.columns = 100
  })

  it('renders a separator line and title', () => {
    const frame = renderFrame(<ServiceApprovalHeader title="Approve tool call" />)
    expect(frame).toContain('Approve tool call')

    const ruleLines = frame
      .split('\n')
      .map((line) => line.trimEnd())
      .filter((line) => /^─{20,}$/.test(line))
    expect(ruleLines).toHaveLength(1)
  })

  it('falls back to 80 columns when stdout columns are unavailable', () => {
    mocks.columns = undefined
    const frame = renderFrame(<ServiceApprovalHeader title="Fallback width" />)

    const ruleLine = frame
      .split('\n')
      .map((line) => line.trimEnd())
      .find((line) => /^─+$/.test(line))

    expect(ruleLine).toBeDefined()
    expect(ruleLine?.length).toBe(80)
  })
})
