import { describe, expect, it } from 'vitest'
import React from 'react'
import { Text } from 'ink'
import { render } from 'ink-testing-library'
import { ApprovalPreview } from '../../components/tool/ApprovalPreview'

describe('ApprovalPreview', () => {
  it('shows remaining line count when positive', () => {
    const { lastFrame } = render(
      <ApprovalPreview fileName="src/file.ts" remainingLines={3}>
        <Text>body</Text>
      </ApprovalPreview>,
    )

    const frame = lastFrame() || ''
    expect(frame).toContain('src/file.ts')
    expect(frame).toContain('body')
    expect(frame).toContain('… +3 lines')
  })

  it('hides remaining line count when remainingLines is zero', () => {
    const { lastFrame } = render(
      <ApprovalPreview fileName="src/file.ts" remainingLines={0}>
        <Text>body</Text>
      </ApprovalPreview>,
    )

    expect(lastFrame() || '').not.toContain('lines')
  })

  it('hides remaining line count when remainingLines is negative', () => {
    const { lastFrame } = render(
      <ApprovalPreview fileName="src/file.ts" remainingLines={-2}>
        <Text>body</Text>
      </ApprovalPreview>,
    )

    expect(lastFrame() || '').not.toContain('lines')
  })
})
