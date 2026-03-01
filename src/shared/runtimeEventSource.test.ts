import { describe, expect, it } from 'vitest'
import { sourceFromRuntimeEventType } from './runtimeEventSource'

describe('sourceFromRuntimeEventType', () => {
  it('maps interactive input event types to expected sources', () => {
    expect(sourceFromRuntimeEventType('approval_request')).toBe('policy')
    expect(sourceFromRuntimeEventType('ask_user_question')).toBe('tool')
  })

  it('maps tool, error, and default event sources', () => {
    expect(sourceFromRuntimeEventType('tool_start')).toBe('tool')
    expect(sourceFromRuntimeEventType('tool_update')).toBe('tool')
    expect(sourceFromRuntimeEventType('error')).toBe('system')
    expect(sourceFromRuntimeEventType('assistant_delta')).toBe('engine')
  })
})
