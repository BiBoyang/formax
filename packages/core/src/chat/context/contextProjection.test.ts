import { describe, expect, it } from 'vitest'
import {
  buildAutoCompactKeepStrategy,
  buildCompactBoundaryMessage,
  buildCompactionSummaryUserText,
  fingerprintCompactBoundaryMessage,
} from './compact'
import { buildContextProjection, mergeDurableSnipSnapshot, scopeDurableSnipStateToHistory } from './contextProjection'
import { createContextCollapseCommittedEntry } from './contextCollapseStore'
import type { PromptMessage } from '../../prompts'

function textMessage(role: 'user' | 'assistant', text: string): PromptMessage {
  return {
    role,
    content: [{ type: 'text', text }],
  }
}

function assistantToolUse(id: string): PromptMessage {
  return {
    role: 'assistant',
    content: [{ type: 'tool_use', id, name: 'Read', input: { file_path: `/repo/${id}.ts` } }] as any,
  }
}

function userToolResult(id: string): PromptMessage {
  return {
    role: 'user',
    content: [{ type: 'tool_result', tool_use_id: id, content: `${id} result` }] as any,
  }
}

function boundary(preTokens = 8192): PromptMessage {
  return buildCompactBoundaryMessage({
    trigger: 'auto',
    preTokens,
    summaryKind: 'model_summary',
    keepStrategy: buildAutoCompactKeepStrategy(2),
  })
}

describe('buildContextProjection', () => {
  it('uses persisted history as every view when no durable compression state exists', () => {
    const history: PromptMessage[] = [
      textMessage('user', 'first request'),
      textMessage('assistant', 'first answer'),
    ]

    const projection = buildContextProjection({ history })

    expect(projection.rawTranscript).toBe(history)
    expect(projection.uiScrollback).toBe(history)
    expect(projection.modelFacingBaseline).toBe(history)
    expect(projection.diagnosticsProjection).toBe(history)
    expect(projection.facts.latestCompactBoundary).toBeNull()
    expect(projection.facts.activeCompactBoundaryFingerprint).toBeNull()
    expect(projection.facts.appliedDurableStages).toEqual([])
    expect(projection.facts.modelFacingBaselineMessageCount).toBe(2)
  })

  it('starts the model-facing baseline after the latest compact boundary', () => {
    const firstBoundary = boundary(4096)
    const latestBoundary = boundary(8192)
    const history: PromptMessage[] = [
      textMessage('user', 'pre-boundary request'),
      firstBoundary,
      textMessage('user', buildCompactionSummaryUserText('first compact summary')),
      textMessage('assistant', 'middle answer'),
      latestBoundary,
      textMessage('user', buildCompactionSummaryUserText('latest compact summary')),
      textMessage('user', 'post-boundary request'),
      textMessage('assistant', 'post-boundary answer'),
    ]

    const projection = buildContextProjection({ history })

    expect(projection.rawTranscript).toBe(history)
    expect(projection.uiScrollback).toEqual([
      textMessage('user', 'pre-boundary request'),
      textMessage('user', buildCompactionSummaryUserText('first compact summary')),
      textMessage('assistant', 'middle answer'),
      textMessage('user', buildCompactionSummaryUserText('latest compact summary')),
      textMessage('user', 'post-boundary request'),
      textMessage('assistant', 'post-boundary answer'),
    ])
    expect(projection.modelFacingBaseline).toEqual([
      textMessage('user', buildCompactionSummaryUserText('latest compact summary')),
      textMessage('user', 'post-boundary request'),
      textMessage('assistant', 'post-boundary answer'),
    ])
    expect(projection.diagnosticsProjection).toEqual(projection.modelFacingBaseline)
    expect(projection.facts.latestCompactBoundary).toEqual(latestBoundary.meta?.compactBoundary)
    expect(projection.facts.activeCompactBoundaryFingerprint).toBe(fingerprintCompactBoundaryMessage(latestBoundary))
    expect(projection.facts.rawTranscriptMessageCount).toBe(history.length)
    expect(projection.facts.modelFacingBaselineMessageCount).toBe(3)
  })

  it('reserves no-op durable snip/collapse placeholders without changing the baseline', () => {
    const history: PromptMessage[] = [
      boundary(),
      textMessage('user', buildCompactionSummaryUserText('compact summary')),
      textMessage('assistant', `older assistant ${'a'.repeat(4000)}`),
      textMessage('assistant', `recent assistant ${'b'.repeat(4000)}`),
    ]

    const projection = buildContextProjection({ history })

    expect(projection.modelFacingBaseline).toHaveLength(3)
    const compactBoundaryFingerprint = fingerprintCompactBoundaryMessage(history[0]!)
    expect(JSON.stringify(projection.modelFacingBaseline)).not.toContain('[snipped')
    expect(projection.durableState.snip).toEqual({
      stage: 'snip',
      status: 'no_state',
      applied: false,
      reason: 'no durable snip state',
      removedMessageCount: 0,
      droppedOrphanToolBlockCount: 0,
      removals: [],
    })
    expect(projection.durableState.collapse).toEqual({
      stage: 'collapse',
      status: 'no_state',
      applied: false,
      reason: 'no durable collapse state',
      committedEntryCount: 0,
      replacedMessageCount: 0,
      droppedOrphanToolBlockCount: 0,
      compactBoundaryFingerprint,
    })
    expect(projection.facts.appliedDurableStages).toEqual([])
  })

  it('applies durable snip ranges to model-facing projection while preserving raw scrollback', () => {
    const compactSummary = textMessage('user', buildCompactionSummaryUserText('compact summary'))
    const olderAssistant = textMessage('assistant', 'older assistant analysis')
    const middleUser = textMessage('user', 'middle request')
    const recentAssistant = textMessage('assistant', 'recent answer')
    const history: PromptMessage[] = [
      boundary(),
      compactSummary,
      olderAssistant,
      middleUser,
      recentAssistant,
    ]

    const projection = buildContextProjection({
      history,
      durableState: {
        snip: {
          schemaVersion: 1,
          removals: [
            {
              kind: 'model_facing_index_range',
              startIndex: 1,
              endIndexExclusive: 3,
              reason: 'durable snip test range',
            },
          ],
        },
      },
    })

    expect(projection.rawTranscript).toBe(history)
    expect(projection.uiScrollback).toEqual([compactSummary, olderAssistant, middleUser, recentAssistant])
    expect(projection.modelFacingBaseline).toEqual([compactSummary, recentAssistant])
    expect(projection.diagnosticsProjection).toEqual(projection.modelFacingBaseline)
    expect(projection.durableState.snip).toEqual({
      stage: 'snip',
      status: 'active',
      applied: true,
      reason: 'applied durable snip removals',
      removedMessageCount: 2,
      droppedOrphanToolBlockCount: 0,
      removals: [
        {
          kind: 'model_facing_index_range',
          startIndex: 1,
          endIndexExclusive: 3,
          reason: 'durable snip test range',
        },
      ],
    })
    expect(projection.facts.appliedDurableStages).toEqual(['snip'])
    expect(projection.facts.modelFacingBaselineMessageCount).toBe(2)
  })

  it('drops orphan tool blocks after durable snip removes the other side of a tool pair', () => {
    const toolUse = assistantToolUse('read-1')
    const toolResult = userToolResult('read-1')
    const history: PromptMessage[] = [
      textMessage('user', 'start'),
      toolUse,
      toolResult,
      textMessage('assistant', 'done'),
    ]

    const projection = buildContextProjection({
      history,
      durableState: {
        snip: {
          schemaVersion: 1,
          removals: [{ kind: 'model_facing_index_range', startIndex: 2, endIndexExclusive: 3 }],
        },
      },
    })

    expect(projection.rawTranscript).toBe(history)
    expect(JSON.stringify(projection.rawTranscript)).toContain('"tool_use_id":"read-1"')
    expect(JSON.stringify(projection.modelFacingBaseline)).not.toContain('"tool_use_id":"read-1"')
    expect(JSON.stringify(projection.modelFacingBaseline)).not.toContain('"id":"read-1"')
    expect(projection.modelFacingBaseline).toEqual([
      textMessage('user', 'start'),
      textMessage('assistant', 'done'),
    ])
    expect(projection.durableState.snip.removedMessageCount).toBe(2)
    expect(projection.durableState.snip.droppedOrphanToolBlockCount).toBe(1)
  })

  it('keeps durable snip projection stable across repeated requests', () => {
    const history: PromptMessage[] = [
      boundary(),
      textMessage('user', buildCompactionSummaryUserText('compact summary')),
      textMessage('assistant', 'older assistant analysis'),
      textMessage('assistant', 'recent answer'),
    ]
    const durableState = {
      snip: {
        schemaVersion: 1 as const,
        removals: [
          {
            kind: 'model_facing_index_range' as const,
            startIndex: 1,
            endIndexExclusive: 2,
          },
        ],
      },
    }

    const first = buildContextProjection({ history, durableState })
    const second = buildContextProjection({ history: [...history], durableState })

    expect(first.modelFacingBaseline).toEqual(second.modelFacingBaseline)
    expect(first.facts.modelFacingBaselineFingerprint).toBe(second.facts.modelFacingBaselineFingerprint)
    expect(JSON.stringify(first.rawTranscript)).toContain('older assistant analysis')
  })

  it('reserves a deferred tool-result content replacement state without replacing content', () => {
    const history: PromptMessage[] = [
      textMessage('assistant', 'before tool'),
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tool-1',
            content: [{ type: 'text', text: 'large tool output' }],
          },
        ],
      },
    ]

    const projection = buildContextProjection({ history })

    expect(projection.modelFacingBaseline).toEqual(history)
    expect(JSON.stringify(projection.modelFacingBaseline)).toContain('large tool output')
    expect(projection.durableState.toolResultContentReplacement).toEqual({
      stage: 'tool_result_content_replacement',
      status: 'deferred',
      applied: false,
      reason: 'Claude Code-style durable tool-result content replacement is deferred',
    })
  })

  it('applies committed collapse entries to the model-facing projection while preserving raw scrollback', () => {
    const compactSummary = textMessage('user', buildCompactionSummaryUserText('compact summary'))
    const olderAssistant = textMessage('assistant', 'older assistant analysis')
    const olderUser = textMessage('user', 'older request')
    const recentAssistant = textMessage('assistant', 'recent answer')
    const recap = textMessage('user', '<system-reminder>committed collapse recap</system-reminder>')
    const compactBoundary = boundary()
    const history: PromptMessage[] = [
      compactBoundary,
      compactSummary,
      olderAssistant,
      olderUser,
      recentAssistant,
    ]

    const projection = buildContextProjection({
      history,
      durableState: {
        collapse: {
          schemaVersion: 1,
          entries: [
            createContextCollapseCommittedEntry({
              id: 'collapse-1',
              createdAtMs: 1000,
              source: 'request_collapse',
              collapsedRange: { kind: 'model_facing_index_range', startIndex: 1, endIndexExclusive: 3 },
              compactBoundaryFingerprint: fingerprintCompactBoundaryMessage(compactBoundary),
              recapMessage: recap,
              metadata: {
                schemaVersion: 1,
                kind: 'request_recap',
                keepLastTurns: 1,
                preservedTailMessageCount: 1,
                retainedCompactSummary: true,
                recentUserPromptCount: 1,
                recentFileCount: 0,
                earlierToolResultBlockCount: 0,
                recapFingerprint: 'collapse-fingerprint',
              },
            }),
          ],
        },
      },
    })

    expect(projection.rawTranscript).toBe(history)
    expect(projection.uiScrollback).toEqual([compactSummary, olderAssistant, olderUser, recentAssistant])
    expect(projection.modelFacingBaseline).toEqual([compactSummary, recap, recentAssistant])
    expect(JSON.stringify(projection.rawTranscript)).toContain('older assistant analysis')
    expect(JSON.stringify(projection.modelFacingBaseline)).not.toContain('older assistant analysis')
    expect(projection.durableState.collapse).toMatchObject({
      stage: 'collapse',
      status: 'active',
      applied: true,
      committedEntryCount: 1,
      replacedMessageCount: 2,
    })
    expect(projection.facts.appliedDurableStages).toEqual(['collapse'])
  })

  it('replays chained collapse entries in commit order', () => {
    const compactSummary = textMessage('user', buildCompactionSummaryUserText('compact summary'))
    const olderAssistant = textMessage('assistant', 'older assistant analysis')
    const olderUser = textMessage('user', 'older request')
    const recentAssistant = textMessage('assistant', 'recent answer')
    const firstRecap = textMessage('user', '<system-reminder>first committed recap</system-reminder>')
    const secondRecap = textMessage('user', '<system-reminder>second committed recap</system-reminder>')
    const compactBoundary = boundary()
    const history: PromptMessage[] = [
      compactBoundary,
      compactSummary,
      olderAssistant,
      olderUser,
      recentAssistant,
    ]

    const projection = buildContextProjection({
      history,
      durableState: {
        collapse: {
          schemaVersion: 1,
          entries: [
            createContextCollapseCommittedEntry({
              id: 'collapse-1',
              createdAtMs: 1000,
              source: 'request_collapse',
              collapsedRange: { kind: 'model_facing_index_range', startIndex: 0, endIndexExclusive: 3 },
              compactBoundaryFingerprint: fingerprintCompactBoundaryMessage(compactBoundary),
              recapMessage: firstRecap,
              metadata: {
                schemaVersion: 1,
                kind: 'request_recap',
                keepLastTurns: 1,
                preservedTailMessageCount: 1,
                retainedCompactSummary: true,
                recentUserPromptCount: 1,
                recentFileCount: 0,
                earlierToolResultBlockCount: 0,
                recapFingerprint: 'first-collapse-fingerprint',
              },
            }),
            createContextCollapseCommittedEntry({
              id: 'collapse-2',
              createdAtMs: 2000,
              source: 'request_collapse',
              collapsedRange: { kind: 'model_facing_index_range', startIndex: 0, endIndexExclusive: 2 },
              compactBoundaryFingerprint: fingerprintCompactBoundaryMessage(compactBoundary),
              recapMessage: secondRecap,
              metadata: {
                schemaVersion: 1,
                kind: 'request_recap',
                keepLastTurns: 0,
                preservedTailMessageCount: 0,
                retainedCompactSummary: false,
                recentUserPromptCount: 0,
                recentFileCount: 0,
                earlierToolResultBlockCount: 0,
                recapFingerprint: 'second-collapse-fingerprint',
              },
            }),
          ],
        },
      },
    })

    expect(projection.modelFacingBaseline).toEqual([secondRecap])
    expect(JSON.stringify(projection.modelFacingBaseline)).not.toContain('first committed recap')
    expect(projection.durableState.collapse).toMatchObject({
      stage: 'collapse',
      status: 'active',
      applied: true,
      committedEntryCount: 2,
      replacedMessageCount: 5,
    })
  })

  it('skips stale collapse entries that do not match the current compact generation', () => {
    const compactSummary = textMessage('user', buildCompactionSummaryUserText('new compact summary'))
    const recentAssistant = textMessage('assistant', 'recent answer after compact')
    const staleRecap = textMessage('user', '<system-reminder>stale committed recap</system-reminder>')
    const history: PromptMessage[] = [boundary(), compactSummary, recentAssistant]

    const projection = buildContextProjection({
      history,
      durableState: {
        collapse: {
          schemaVersion: 1,
          entries: [
            createContextCollapseCommittedEntry({
              id: 'stale-collapse',
              createdAtMs: 1000,
              source: 'request_collapse',
              collapsedRange: { kind: 'model_facing_index_range', startIndex: 0, endIndexExclusive: 2 },
              compactBoundaryFingerprint: 'old-compact-generation',
              recapMessage: staleRecap,
              metadata: {
                schemaVersion: 1,
                kind: 'request_recap',
                keepLastTurns: 1,
                preservedTailMessageCount: 1,
                retainedCompactSummary: true,
                recentUserPromptCount: 1,
                recentFileCount: 0,
                earlierToolResultBlockCount: 0,
                recapFingerprint: 'stale-collapse-fingerprint',
              },
            }),
          ],
        },
      },
    })

    expect(projection.modelFacingBaseline).toEqual([compactSummary, recentAssistant])
    expect(JSON.stringify(projection.modelFacingBaseline)).not.toContain('stale committed recap')
    expect(projection.durableState.collapse).toMatchObject({
      stage: 'collapse',
      status: 'no_state',
      applied: false,
      committedEntryCount: 1,
      replacedMessageCount: 0,
    })
  })

  it('distinguishes compact generations by boundary metadata when filtering collapse entries', () => {
    const oldBoundary = buildCompactBoundaryMessage({
      trigger: 'auto',
      preTokens: 2048,
      summaryKind: 'model_summary',
      keepStrategy: buildAutoCompactKeepStrategy(1),
    })
    const currentBoundary = buildCompactBoundaryMessage({
      trigger: 'auto',
      preTokens: 8192,
      summaryKind: 'model_summary',
      keepStrategy: buildAutoCompactKeepStrategy(2),
    })
    const compactSummary = textMessage('user', buildCompactionSummaryUserText('current compact summary'))
    const recentAssistant = textMessage('assistant', 'recent answer after current compact')
    const staleRecap = textMessage('user', '<system-reminder>old compact recap</system-reminder>')

    expect(fingerprintCompactBoundaryMessage(oldBoundary)).not.toBe(
      fingerprintCompactBoundaryMessage(currentBoundary),
    )

    const projection = buildContextProjection({
      history: [currentBoundary, compactSummary, recentAssistant],
      durableState: {
        collapse: {
          schemaVersion: 1,
          entries: [
            createContextCollapseCommittedEntry({
              id: 'old-generation-collapse',
              createdAtMs: 1000,
              source: 'request_collapse',
              collapsedRange: { kind: 'model_facing_index_range', startIndex: 0, endIndexExclusive: 2 },
              compactBoundaryFingerprint: fingerprintCompactBoundaryMessage(oldBoundary),
              recapMessage: staleRecap,
              metadata: {
                schemaVersion: 1,
                kind: 'request_recap',
                keepLastTurns: 1,
                preservedTailMessageCount: 1,
                retainedCompactSummary: true,
                recentUserPromptCount: 1,
                recentFileCount: 0,
                earlierToolResultBlockCount: 0,
                recapFingerprint: 'old-generation-collapse-fingerprint',
              },
            }),
          ],
        },
      },
    })

    expect(projection.modelFacingBaseline).toEqual([compactSummary, recentAssistant])
    expect(JSON.stringify(projection.modelFacingBaseline)).not.toContain('old compact recap')
  })

  it('uses the collapse snapshot compact generation when resumed history has no boundary row', () => {
    const compactBoundary = boundary()
    const compactBoundaryFingerprint = fingerprintCompactBoundaryMessage(compactBoundary)
    const compactSummary = textMessage('user', buildCompactionSummaryUserText('resumed compact summary'))
    const oldAssistant = textMessage('assistant', 'old resumed analysis')
    const recentAssistant = textMessage('assistant', 'recent resumed answer')
    const recap = textMessage('user', '<system-reminder>resumed committed recap</system-reminder>')

    const projection = buildContextProjection({
      history: [compactSummary, oldAssistant, recentAssistant],
      durableState: {
        collapse: {
          schemaVersion: 1,
          activeCompactBoundaryFingerprint: compactBoundaryFingerprint,
          entries: [
            createContextCollapseCommittedEntry({
              id: 'resumed-collapse',
              createdAtMs: 1000,
              source: 'request_collapse',
              collapsedRange: { kind: 'model_facing_index_range', startIndex: 1, endIndexExclusive: 2 },
              compactBoundaryFingerprint,
              recapMessage: recap,
              metadata: {
                schemaVersion: 1,
                kind: 'request_recap',
                keepLastTurns: 1,
                preservedTailMessageCount: 1,
                retainedCompactSummary: true,
                recentUserPromptCount: 1,
                recentFileCount: 0,
                earlierToolResultBlockCount: 0,
                recapFingerprint: 'resumed-collapse-fingerprint',
              },
            }),
          ],
        },
      },
    })

    expect(projection.modelFacingBaseline).toEqual([compactSummary, recap, recentAssistant])
    expect(projection.facts.latestCompactBoundary).toBeNull()
    expect(projection.facts.activeCompactBoundaryFingerprint).toBe(compactBoundaryFingerprint)
    expect(JSON.stringify(projection.modelFacingBaseline)).not.toContain('old resumed analysis')
  })

  it('drops orphan tool blocks after durable collapse removes one side of a tool pair', () => {
    const recap = textMessage('user', '<system-reminder>committed collapse recap</system-reminder>')
    const toolUse = assistantToolUse('collapse-read-1')
    const toolResult = userToolResult('collapse-read-1')
    const finalAssistant = textMessage('assistant', 'done after collapse')
    const compactBoundary = boundary()
    const history: PromptMessage[] = [compactBoundary, toolUse, toolResult, finalAssistant]

    const projection = buildContextProjection({
      history,
      durableState: {
        collapse: {
          schemaVersion: 1,
          entries: [
            createContextCollapseCommittedEntry({
              id: 'collapse-tool-pair',
              createdAtMs: 1000,
              source: 'request_collapse',
              collapsedRange: { kind: 'model_facing_index_range', startIndex: 0, endIndexExclusive: 1 },
              compactBoundaryFingerprint: fingerprintCompactBoundaryMessage(compactBoundary),
              recapMessage: recap,
              metadata: {
                schemaVersion: 1,
                kind: 'request_recap',
                keepLastTurns: 1,
                preservedTailMessageCount: 1,
                retainedCompactSummary: false,
                recentUserPromptCount: 0,
                recentFileCount: 0,
                earlierToolResultBlockCount: 1,
                recapFingerprint: 'collapse-tool-pair-fingerprint',
              },
            }),
          ],
        },
      },
    })

    expect(JSON.stringify(projection.rawTranscript)).toContain('"tool_use_id":"collapse-read-1"')
    expect(JSON.stringify(projection.modelFacingBaseline)).not.toContain('"tool_use_id":"collapse-read-1"')
    expect(JSON.stringify(projection.modelFacingBaseline)).not.toContain('"id":"collapse-read-1"')
    expect(projection.modelFacingBaseline).toEqual([recap, finalAssistant])
    expect(projection.durableState.collapse).toMatchObject({
      stage: 'collapse',
      status: 'active',
      applied: true,
      committedEntryCount: 1,
      replacedMessageCount: 1,
      droppedOrphanToolBlockCount: 1,
    })
  })

  it('rejects unfingerprinted collapse entries on boundaryless baselines', () => {
    const staleRecap = textMessage('user', '<system-reminder>unfingerprinted recap</system-reminder>')
    const history: PromptMessage[] = [
      textMessage('user', 'fresh boundaryless request'),
      textMessage('assistant', 'fresh boundaryless answer'),
    ]

    const projection = buildContextProjection({
      history,
      durableState: {
        collapse: {
          schemaVersion: 1,
          entries: [
            createContextCollapseCommittedEntry({
              id: 'legacy-collapse',
              createdAtMs: 1000,
              source: 'request_collapse',
              collapsedRange: { kind: 'model_facing_index_range', startIndex: 0, endIndexExclusive: 1 },
              recapMessage: staleRecap,
              metadata: {
                schemaVersion: 1,
                kind: 'request_recap',
                keepLastTurns: 1,
                preservedTailMessageCount: 1,
                retainedCompactSummary: false,
                recentUserPromptCount: 1,
                recentFileCount: 0,
                earlierToolResultBlockCount: 0,
                recapFingerprint: 'legacy-collapse-fingerprint',
              },
            }),
          ],
        },
      },
    })

    expect(projection.modelFacingBaseline).toEqual(history)
    expect(JSON.stringify(projection.modelFacingBaseline)).not.toContain('unfingerprinted recap')
    expect(projection.durableState.collapse).toMatchObject({
      stage: 'collapse',
      status: 'no_state',
      applied: false,
      committedEntryCount: 1,
      compactBoundaryFingerprint: null,
    })
  })

  it('emits a stable projection fingerprint for later cache-safety assertions', () => {
    const history: PromptMessage[] = [
      boundary(),
      textMessage('user', buildCompactionSummaryUserText('compact summary')),
      textMessage('assistant', 'post-boundary answer'),
    ]

    const first = buildContextProjection({ history })
    const second = buildContextProjection({ history: [...history] })

    expect(first.facts.modelFacingBaselineFingerprint).toMatch(/^[a-f0-9]{16}$/)
    expect(second.facts.modelFacingBaselineFingerprint).toBe(first.facts.modelFacingBaselineFingerprint)
  })
})

describe('mergeDurableSnipSnapshot', () => {
  it('translates new removals from the already-snipped baseline into the original baseline', () => {
    const snapshot = mergeDurableSnipSnapshot({
      existingState: {
        schemaVersion: 1,
        activeCompactBoundaryFingerprint: null,
        removals: [
          {
            kind: 'model_facing_index_range',
            startIndex: 0,
            endIndexExclusive: 1,
            reason: 'previous request snip',
            removedMessageFingerprints: ['fp-0'],
          },
        ],
      },
      newRemovals: [
        {
          kind: 'model_facing_index_range',
          startIndex: 0,
          endIndexExclusive: 1,
          reason: 'next request snip',
          removedMessageFingerprints: ['fp-1'],
        },
      ],
      compactBoundaryFingerprint: null,
    })

    expect(snapshot).toEqual({
      schemaVersion: 1,
      activeCompactBoundaryFingerprint: null,
      removals: [
        {
          kind: 'model_facing_index_range',
          startIndex: 0,
          endIndexExclusive: 1,
          reason: 'previous request snip',
          removedMessageFingerprints: ['fp-0'],
        },
        {
          kind: 'model_facing_index_range',
          startIndex: 1,
          endIndexExclusive: 2,
          reason: 'next request snip',
          removedMessageFingerprints: ['fp-1'],
        },
      ],
    })
  })

  it('drops prior unscoped removals when a compact boundary becomes active', () => {
    const snapshot = mergeDurableSnipSnapshot({
      existingState: {
        schemaVersion: 1,
        activeCompactBoundaryFingerprint: null,
        removals: [
          {
            kind: 'model_facing_index_range',
            startIndex: 0,
            endIndexExclusive: 1,
          },
        ],
      },
      newRemovals: [
        {
          kind: 'model_facing_index_range',
          startIndex: 0,
          endIndexExclusive: 1,
        },
      ],
      compactBoundaryFingerprint: 'boundary-a',
    })

    expect(snapshot).toEqual({
      schemaVersion: 1,
      activeCompactBoundaryFingerprint: 'boundary-a',
      removals: [
        {
          kind: 'model_facing_index_range',
          startIndex: 0,
          endIndexExclusive: 1,
        },
      ],
    })
  })
})

describe('scopeDurableSnipStateToHistory', () => {
  it('clears unscoped durable snip removals when the in-memory history has a fresh compact boundary', () => {
    const compactBoundary = boundary()
    const scoped = scopeDurableSnipStateToHistory({
      state: {
        schemaVersion: 1,
        activeCompactBoundaryFingerprint: null,
        removals: [{ kind: 'model_facing_index_range', startIndex: 0, endIndexExclusive: 1 }],
      },
      history: [
        compactBoundary,
        textMessage('user', buildCompactionSummaryUserText('compact summary')),
        textMessage('assistant', 'preserved tail'),
      ],
    })

    expect(scoped).toEqual({
      schemaVersion: 1,
      activeCompactBoundaryFingerprint: fingerprintCompactBoundaryMessage(compactBoundary),
      removals: [],
    })
  })
})
