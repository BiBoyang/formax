import { describe, expect, it } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import type { Msg } from '../../shared/toolMessageTypes'
import { FallbackToolPresenter, shouldShowSurfaceSuffix, toSurfaceSuffix } from './FallbackToolPresenter'

function createMessage(overrides: Partial<Msg> = {}): Msg {
  return {
    id: 'msg-1234',
    role: 'tool',
    content: 'content',
    timestamp: new Date(),
    ...overrides,
  }
}

describe('fallback presenter', () => {
  it('renders unknown tool when toolInfo is missing', () => {
    const frame = render(<FallbackToolPresenter message={createMessage({ toolInfo: undefined })} />).lastFrame() ?? ''
    expect(frame).toContain('Unknown tool')
  })

  it('renders running header without subline', () => {
    const frame =
      render(
        <FallbackToolPresenter
          message={
            createMessage({
              toolInfo: { name: 'Read', input: { file_path: 'a.ts' }, status: 'running' },
            })
          }
        />,
      ).lastFrame() ?? ''

    expect(frame).toContain('Read')
    expect(frame).not.toContain('⎿')
  })

  it('renders completed content and details', () => {
    const frame =
      render(
        <FallbackToolPresenter
          message={
            createMessage({
              content: 'done',
              toolInfo: {
                name: 'Bash',
                input: { command: 'ls' },
                status: 'completed',
                middleLines: ['line-1', 'line-2'],
                expandInfo: 'more',
              },
            })
          }
        />,
      ).lastFrame() ?? ''

    expect(frame).toContain('Bash')
    expect(frame).toContain('done')
    expect(frame).toContain('line-1')
    expect(frame).toContain('line-2')
    expect(frame).toContain('more')
  })

  it('renders compact error detail', () => {
    const frame =
      render(
        <FallbackToolPresenter
          message={
            createMessage({
              content: 'error happened',
              toolInfo: {
                name: 'Read',
                input: { file_path: 'a.ts' },
                status: 'error',
                middleLines: ['ErrorCode: NOPE', 'detail line'],
                expandInfo: 'Workspace roots: /repo',
              },
            })
          }
        />,
      ).lastFrame() ?? ''

    expect(frame).toContain('error happened')
    expect(frame).toContain('detail line')
    expect(frame).not.toContain('Workspace roots')
  })

  it('shouldShowSurfaceSuffix checks env toggle values', () => {
    const prev = process.env.FORMAX_HOOKS_DEBUG
    process.env.FORMAX_HOOKS_DEBUG = '1'
    expect(shouldShowSurfaceSuffix()).toBe(true)
    process.env.FORMAX_HOOKS_DEBUG = 'true'
    expect(shouldShowSurfaceSuffix()).toBe(true)
    process.env.FORMAX_HOOKS_DEBUG = 'yes'
    expect(shouldShowSurfaceSuffix()).toBe(true)
    process.env.FORMAX_HOOKS_DEBUG = 'false'
    expect(shouldShowSurfaceSuffix()).toBe(false)
    process.env.FORMAX_HOOKS_DEBUG = prev
  })

  it('toSurfaceSuffix handles no toolUseId and toolUseId formats', () => {
    const prev = process.env.FORMAX_HOOKS_DEBUG
    process.env.FORMAX_HOOKS_DEBUG = 'true'

    expect(toSurfaceSuffix(createMessage({ id: 'abcd', surfaceHint: 'transient' }))).toBe('trans@abcd:abcd')
    expect(toSurfaceSuffix(createMessage({ id: '', surfaceHint: 'transient' }))).toBe('trans')
    expect(
      toSurfaceSuffix(
        createMessage({
          id: '',
          surfaceOwner: 'static',
          toolInfo: { name: 'Read', input: {}, status: 'completed', toolUseId: 'tool-5678' },
        }),
      ),
    ).toBe('static#5678')
    expect(
      toSurfaceSuffix(
        createMessage({
          id: 'id-1234',
          surfaceOwner: 'static',
          toolInfo: { name: 'Read', input: {}, status: 'completed', toolUseId: 'tool-5678' },
        }),
      ),
    ).toBe('static#5678@1234:id-1234')
    expect(toSurfaceSuffix(createMessage({ id: 'x', surfaceHint: 'unknown' as any }))).toBeNull()

    process.env.FORMAX_HOOKS_DEBUG = prev
  })

  it('covers non-running branches without params/expandInfo and empty content', () => {
    const frame =
      render(
        <FallbackToolPresenter
          message={createMessage({
            content: '',
            toolInfo: {
              name: 'Edit',
              input: {},
              status: 'completed',
              middleLines: undefined,
              expandInfo: undefined,
            },
          })}
        />,
      ).lastFrame() ?? ''

    expect(frame).toContain('Edit')
    expect(frame).not.toContain('()')
  })

  it('covers error branch without compact error details', () => {
    const frame =
      render(
        <FallbackToolPresenter
          message={createMessage({
            content: '',
            toolInfo: {
              name: 'Read',
              input: {},
              status: 'error',
              middleLines: [],
              expandInfo: undefined,
            },
          })}
        />,
      ).lastFrame() ?? ''

    expect(frame).toContain('Read')
    expect(frame).toContain('⎿')
  })
})
