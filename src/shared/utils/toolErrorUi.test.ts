import { describe, expect, it } from 'vitest'
import { pickCompactErrorDetailLine } from './toolErrorUi'

describe('utils/toolErrorUi', () => {
  it('returns null when no usable lines exist', () => {
    expect(pickCompactErrorDetailLine({})).toBeNull()
    expect(pickCompactErrorDetailLine({ middleLines: [' ', '\t'] })).toBeNull()
  })

  it('skips omitted patterns and picks first valid middle line', () => {
    const line = pickCompactErrorDetailLine({
      middleLines: [
        'ErrorCode: 403',
        'Workspace roots: /repo',
        'Hint: do x',
        'See docs: /docs',
        'Try again',
        'Re-run command',
        'sub-agent timeout',
        ' actual detail ',
      ],
    })
    expect(line).toBe('actual detail')
  })

  it('falls back to expandInfo when middleLines have no valid detail', () => {
    const line = pickCompactErrorDetailLine({
      middleLines: ['Hint: hidden'],
      expandInfo: '  keep this  ',
    })
    expect(line).toBe('keep this')
  })

  it('trims nullish entries before selecting a valid detail', () => {
    const line = pickCompactErrorDetailLine({
      middleLines: [null as any, undefined as any, ' detail-ok '],
    })
    expect(line).toBe('detail-ok')
  })

  it('returns null when expandInfo is blank or omitted by pattern', () => {
    expect(pickCompactErrorDetailLine({ expandInfo: '   ' })).toBeNull()
    expect(pickCompactErrorDetailLine({ expandInfo: 'subagent details' })).toBeNull()
  })
})
