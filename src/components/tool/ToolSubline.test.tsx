import { describe, expect, it } from 'vitest'
import React from 'react'
import { Text } from 'ink'
import { render } from 'ink-testing-library'
import { ToolIndented, ToolIndentedLine, ToolSubline } from './ToolSubline'

describe('ToolSubline', () => {
  it('renders plain text content with the subline prefix', () => {
    const { lastFrame } = render(<ToolSubline status="completed" text="All good" />)
    const frame = lastFrame()
    expect(frame).toContain('⎿')
    expect(frame).toContain('All good')
  })

  it('falls back to text when children only contain whitespace nodes', () => {
    const { lastFrame } = render(
      <ToolSubline status="completed" text="fallback text">
        {'   '}
        {'\n'}
      </ToolSubline>,
    )
    expect(lastFrame()).toContain('fallback text')
  })

  it('keeps multiple non-whitespace children and strips surrounding whitespace', () => {
    const { lastFrame } = render(
      <ToolSubline status="completed">
        {'   '}
        <Text>alpha</Text>
        <Text>beta</Text>
        {'   '}
      </ToolSubline>,
    )
    const frame = lastFrame()
    expect(frame).toContain('alpha')
    expect(frame).toContain('beta')
  })

  it('renders error text when status is error', () => {
    const { lastFrame } = render(<ToolSubline status="error" text="failed to apply patch" />)
    expect(lastFrame()).toContain('failed to apply patch')
  })

  it('renders an empty content cell when no text or children are provided', () => {
    const { lastFrame } = render(<ToolSubline status="completed" />)
    expect(lastFrame()).toContain('⎿')
  })
})

describe('ToolIndentedLine', () => {
  it('renders default tone text when tone is omitted', () => {
    const { lastFrame } = render(<ToolIndentedLine text="plain output" />)
    expect(lastFrame()).toContain('plain output')
  })

  it('renders muted tone text', () => {
    const { lastFrame } = render(<ToolIndentedLine tone="muted" text="muted output" />)
    expect(lastFrame()).toContain('muted output')
  })

  it('renders error tone text', () => {
    const { lastFrame } = render(<ToolIndentedLine tone="error" text="permission denied" />)
    expect(lastFrame()).toContain('permission denied')
  })
})

describe('ToolIndented', () => {
  it('renders default tone when tone is omitted', () => {
    const { lastFrame } = render(<ToolIndented>plain line</ToolIndented>)
    expect(lastFrame()).toContain('plain line')
  })

  it('renders muted and error tones while cleaning whitespace children', () => {
    const muted = render(
      <ToolIndented tone="muted">
        {'   '}
        <Text>muted line</Text>
      </ToolIndented>,
    )
    expect(muted.lastFrame()).toContain('muted line')

    const error = render(
      <ToolIndented tone="error">
        <Text>error line</Text>
      </ToolIndented>,
    )
    expect(error.lastFrame()).toContain('error line')
  })
})
