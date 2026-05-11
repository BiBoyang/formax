import { describe, expect, it } from 'vitest'
import {
  parseInputSubmitResponse,
  parseResolvedInputsResponse,
  parseThreadListResponse,
  parseThreadMessagesResponse,
  parseThreadReadResponse,
  parseThreadResumeResponse,
  parseThreadReplayResponse,
  parseThreadStartResponse,
  parseTurnStartLikeResponse,
} from './rpcContracts'

const SYSTEM_CONTRIBUTOR = {
  kind: 'system_section' as const,
  key: 'system_section:system',
  label: 'System section: System',
  tokens: 12,
  systemSectionKey: 'system',
}

const SNAPSHOT_CONTRIBUTOR = {
  kind: 'message' as const,
  key: 'message:user:1',
  label: 'User message #1: "hello"',
  tokens: 20,
  role: 'user' as const,
  ordinal: 1,
}

const ASSEMBLED_CONTRIBUTOR = {
  kind: 'tool_result' as const,
  key: 'tool_result:read-1:0',
  label: 'Tool result: Read /repo/a.ts',
  tokens: 75,
  role: 'user' as const,
  ordinal: 1,
  toolUseId: 'read-1',
  toolName: 'Read',
}

const COLLAPSE_RECAP_CONTRIBUTOR = {
  kind: 'collapse_recap' as const,
  key: 'collapse_recap:user:1',
  label: 'Collapse recap #1: older continuation summary (3 messages)',
  tokens: 28,
  role: 'user' as const,
  ordinal: 1,
}

describe('rpcContracts', () => {
  it('parses thread/start response and rejects invalid payload', () => {
    expect(parseThreadStartResponse({ thread: { id: 'thread-1', cwd: '/repo' } })).toEqual({
      id: 'thread-1',
      cwd: '/repo',
    })
    expect(parseThreadStartResponse({ thread: { id: '' } })).toBeNull()
    expect(parseThreadStartResponse({})).toBeNull()
  })

  it('parses turn/start and command/dispatch like response shape', () => {
    expect(
      parseTurnStartLikeResponse({
        turn: { id: 'turn-1' },
        local: {
          stdout: 'hello',
          diagnostics: {
            kind: 'formax.context_diagnostics',
            schemaVersion: 1,
            mode: 'normal',
            model: 'claude-3-5-sonnet-latest',
            latestCompactBoundary: {
              schemaVersion: 1,
              trigger: 'reactive',
              triggerReason: {
                kind: 'reactive_error',
                detail: 'HTTP 413',
              },
              summaryKind: 'session_memory',
              keepStrategy: {
                kind: 'keep_combo',
                keepLastTurns: 2,
                keepMinTokens: 1200,
                keepMinUserTurns: 1,
              },
            },
            latestRequestCollapse: {
              phase: 'reactive_retry',
              collapsedHeadMessageCount: 3,
              estimatedTokensSaved: 120,
              recapFingerprint: 'abcdef0123456789',
            },
            latestReactiveCompact: {
              triggerKind: 'maximum_context_length',
              triggerDetail: 'context window exceeded',
              strategy: 'session_memory',
            },
            snapshot: {
              totalTokens: 100,
              systemTokens: 20,
              systemSectionBreakdown: [SYSTEM_CONTRIBUTOR],
              historyTokens: 80,
              toolResultTokens: 30,
              otherHistoryTokens: 50,
              messageCount: 4,
              userMessageCount: 2,
              assistantMessageCount: 2,
              toolResultBlockCount: 1,
              microCompactedToolResultCount: 0,
              toolResultCountsByToolName: [{ toolName: 'Read', count: 1 }],
              microCompactedCountsByToolName: [],
              contextWindowTokens: 200000,
              effectiveLimitTokens: 180000,
              autoCompactLimitTokens: 170000,
              baselineTokens: 1000,
              percentRemaining: 99,
              remainingToEffectiveLimit: 179900,
              remainingToAutoCompactLimit: 169900,
              shouldAutoCompact: false,
              topSnapshotContributors: [SNAPSHOT_CONTRIBUTOR],
            },
            nextTurnFixed: {
              fixedGroups: [{ label: 'reminders', blockCount: 1, tokens: 10 }],
              assembledLedger: [
                { kind: 'system_total', key: 'system_total', label: 'System prompt total', tokens: 15, blockCount: 1 },
                {
                  kind: 'request_history',
                  key: 'request_history',
                  label: 'Request history after middle-layer strategies',
                  tokens: 55,
                  messageCount: 3,
                },
                {
                  kind: 'tool_result_group',
                  key: 'tool_result_group',
                  label: 'Tool-result group after budget replacement (pre-collapse)',
                  tokens: 20,
                },
                {
                  kind: 'tool_result_budget_savings',
                  key: 'tool_result_budget_savings',
                  label: 'Tool-result budget savings',
                  tokens: 140,
                  blockCount: 1,
                },
                { kind: 'fixed_total', key: 'fixed_total', label: 'Fixed additions total', tokens: 10, blockCount: 1 },
                { kind: 'assembled_total', key: 'assembled_total', label: 'Assembled total before future user text', tokens: 85 },
              ],
              strategyCoordination: [
                {
                  stage: 'microcompact',
                  role: 'budget_reducer',
                  scope: 'persisted_history_candidate',
                  disposition: 'applied',
                  terminal: false,
                  advisory: true,
                  reason: 'compacted 1 eligible older block(s)',
                  estimatedTokensSaved: 200,
                  inputTokens: 80,
                  outputTokens: 60,
                },
                {
                  stage: 'prune',
                  role: 'terminal_fallback',
                  scope: 'assembled_request_envelope',
                  disposition: 'skipped',
                  terminal: true,
                  advisory: false,
                  reason: 'assembled request already within effective limit',
                  estimatedTokensSaved: 0,
                  inputTokens: 85,
                  outputTokens: 85,
                },
              ],
              strategyControlPlane: {
                stageOrder: ['microcompact', 'tool_result_budget', 'snip', 'collapse', 'prune'],
                appliedStages: ['microcompact'],
                skippedStages: ['snip', 'prune'],
                terminalStage: 'prune',
                terminalDisposition: 'skipped',
                dominantSavingStage: 'microcompact',
                dominantSavingTokens: 200,
              },
              toolResultBudgetImpact: {
                replacedBlocks: 1,
                replacedToolNames: ['Read'],
                estimatedTokensSaved: 140,
                keptRecentBlocks: 1,
                budgetTokens: 2600,
                totalToolResultTokensBefore: 160,
                totalToolResultTokensAfter: 20,
              },
              microCompactImpact: {
                compactedBlocks: 1,
                compactedToolNames: ['Read'],
                estimatedTokensSaved: 200,
                keptRecentBlocks: 2,
              },
              snipImpact: {
                snippedMessages: 0,
                snippedBlocks: 0,
                estimatedTokensSaved: 0,
                keptRecentMessages: 0,
                minTextChars: 1800,
              },
              collapseImpact: {
                collapsed: true,
                collapsedHeadMessageCount: 3,
                estimatedTokensSaved: 120,
                projectedHistoryTokensAfterCollapse: 55,
                projectedHistoryDeltaTokens: -20,
                metadata: {
                  schemaVersion: 1,
                  kind: 'request_recap',
                  keepLastTurns: 2,
                  preservedTailMessageCount: 3,
                  retainedCompactSummary: true,
                  recentUserPromptCount: 2,
                  recentFileCount: 1,
                  earlierToolResultBlockCount: 1,
                  recapFingerprint: 'abcd1234efef5678',
                },
              },
              lifecycleMarkers: [
                {
                  stage: 'snapshot',
                  label: 'snapshot',
                  totalTokens: 90,
                  historyTokens: 80,
                  fixedTokens: 10,
                  deltaFromSnapshot: 0,
                  remainingToEffectiveLimit: 179910,
                  remainingToAutoCompactLimit: 169910,
                  shouldAutoCompact: false,
                },
              ],
              projectedHistoryTokens: 75,
              projectedHistoryDeltaTokens: -5,
              fixedTokens: 10,
              totalTokens: 85,
              remainingToEffectiveLimit: 179915,
              remainingToAutoCompactLimit: 169915,
              shouldAutoCompact: false,
              autoCompactSkipReason: 'below threshold (used=85 limit=170000)',
              pruneSkipReason: 'within effective limit (used=85 limit=180000)',
              topAssembledContributors: [COLLAPSE_RECAP_CONTRIBUTOR, ASSEMBLED_CONTRIBUTOR],
            },
            notes: ['note-1'],
          },
        },
      }),
    ).toEqual({
      turnId: 'turn-1',
      localStdout: 'hello',
      localDiagnostics: {
        kind: 'formax.context_diagnostics',
        schemaVersion: 1,
        mode: 'normal',
        model: 'claude-3-5-sonnet-latest',
        latestCompactBoundary: {
          schemaVersion: 1,
          trigger: 'reactive',
          triggerReason: {
            kind: 'reactive_error',
            detail: 'HTTP 413',
          },
          summaryKind: 'session_memory',
          keepStrategy: {
            kind: 'keep_combo',
            keepLastTurns: 2,
            keepMinTokens: 1200,
            keepMinUserTurns: 1,
          },
        },
        latestRequestCollapse: {
          phase: 'reactive_retry',
          collapsedHeadMessageCount: 3,
          estimatedTokensSaved: 120,
          recapFingerprint: 'abcdef0123456789',
        },
        latestReactiveCompact: {
          triggerKind: 'maximum_context_length',
          triggerDetail: 'context window exceeded',
          strategy: 'session_memory',
        },
        snapshot: {
          totalTokens: 100,
          systemTokens: 20,
          systemSectionBreakdown: [SYSTEM_CONTRIBUTOR],
          historyTokens: 80,
          toolResultTokens: 30,
          otherHistoryTokens: 50,
          messageCount: 4,
          userMessageCount: 2,
          assistantMessageCount: 2,
          toolResultBlockCount: 1,
          microCompactedToolResultCount: 0,
          toolResultCountsByToolName: [{ toolName: 'Read', count: 1 }],
          microCompactedCountsByToolName: [],
          contextWindowTokens: 200000,
          effectiveLimitTokens: 180000,
          autoCompactLimitTokens: 170000,
          baselineTokens: 1000,
          percentRemaining: 99,
          remainingToEffectiveLimit: 179900,
          remainingToAutoCompactLimit: 169900,
          shouldAutoCompact: false,
          topSnapshotContributors: [SNAPSHOT_CONTRIBUTOR],
        },
            nextTurnFixed: {
              fixedGroups: [{ label: 'reminders', blockCount: 1, tokens: 10 }],
              assembledLedger: [
                { kind: 'system_total', key: 'system_total', label: 'System prompt total', tokens: 15, blockCount: 1 },
                {
                  kind: 'request_history',
                  key: 'request_history',
                  label: 'Request history after middle-layer strategies',
                  tokens: 55,
                  messageCount: 3,
                },
                {
                  kind: 'tool_result_group',
                  key: 'tool_result_group',
                  label: 'Tool-result group after budget replacement (pre-collapse)',
                  tokens: 20,
                },
                {
                  kind: 'tool_result_budget_savings',
                  key: 'tool_result_budget_savings',
                  label: 'Tool-result budget savings',
                  tokens: 140,
                  blockCount: 1,
                },
                { kind: 'fixed_total', key: 'fixed_total', label: 'Fixed additions total', tokens: 10, blockCount: 1 },
                { kind: 'assembled_total', key: 'assembled_total', label: 'Assembled total before future user text', tokens: 85 },
              ],
              strategyCoordination: [
                {
                  stage: 'microcompact',
                  role: 'budget_reducer',
                  scope: 'persisted_history_candidate',
                  disposition: 'applied',
                  terminal: false,
                  advisory: true,
                  reason: 'compacted 1 eligible older block(s)',
                  estimatedTokensSaved: 200,
                  inputTokens: 80,
                  outputTokens: 60,
                },
                {
                  stage: 'prune',
                  role: 'terminal_fallback',
                  scope: 'assembled_request_envelope',
                  disposition: 'skipped',
                  terminal: true,
                  advisory: false,
                  reason: 'assembled request already within effective limit',
                  estimatedTokensSaved: 0,
                  inputTokens: 85,
                  outputTokens: 85,
                },
              ],
              strategyControlPlane: {
                stageOrder: ['microcompact', 'tool_result_budget', 'snip', 'collapse', 'prune'],
                appliedStages: ['microcompact'],
                skippedStages: ['snip', 'prune'],
                terminalStage: 'prune',
                terminalDisposition: 'skipped',
                dominantSavingStage: 'microcompact',
                dominantSavingTokens: 200,
              },
              toolResultBudgetImpact: {
                replacedBlocks: 1,
                replacedToolNames: ['Read'],
                estimatedTokensSaved: 140,
                keptRecentBlocks: 1,
                budgetTokens: 2600,
                totalToolResultTokensBefore: 160,
                totalToolResultTokensAfter: 20,
              },
              microCompactImpact: {
                compactedBlocks: 1,
                compactedToolNames: ['Read'],
            estimatedTokensSaved: 200,
            keptRecentBlocks: 2,
          },
          snipImpact: {
            snippedMessages: 0,
            snippedBlocks: 0,
            estimatedTokensSaved: 0,
            keptRecentMessages: 0,
            minTextChars: 1800,
          },
          collapseImpact: {
            collapsed: true,
            collapsedHeadMessageCount: 3,
            estimatedTokensSaved: 120,
            projectedHistoryTokensAfterCollapse: 55,
            projectedHistoryDeltaTokens: -20,
            metadata: {
              schemaVersion: 1,
              kind: 'request_recap',
              keepLastTurns: 2,
              preservedTailMessageCount: 3,
              retainedCompactSummary: true,
              recentUserPromptCount: 2,
              recentFileCount: 1,
              earlierToolResultBlockCount: 1,
              recapFingerprint: 'abcd1234efef5678',
            },
          },
          lifecycleMarkers: [
            {
              stage: 'snapshot',
              label: 'snapshot',
              totalTokens: 90,
              historyTokens: 80,
              fixedTokens: 10,
              deltaFromSnapshot: 0,
              remainingToEffectiveLimit: 179910,
              remainingToAutoCompactLimit: 169910,
              shouldAutoCompact: false,
            },
          ],
          projectedHistoryTokens: 75,
          projectedHistoryDeltaTokens: -5,
          fixedTokens: 10,
          totalTokens: 85,
          remainingToEffectiveLimit: 179915,
          remainingToAutoCompactLimit: 169915,
          shouldAutoCompact: false,
          autoCompactSkipReason: 'below threshold (used=85 limit=170000)',
          pruneSkipReason: 'within effective limit (used=85 limit=180000)',
          topAssembledContributors: [COLLAPSE_RECAP_CONTRIBUTOR, ASSEMBLED_CONTRIBUTOR],
        },
        notes: ['note-1'],
      },
    })
    expect(parseTurnStartLikeResponse({ turn: {}, local: {} })).toEqual({
      turnId: null,
      localStdout: '',
      localDiagnostics: null,
    })
  })

  it('rejects malformed diagnostics payloads instead of exposing loose partial records', () => {
    expect(
      parseTurnStartLikeResponse({
        turn: { id: 'turn-1' },
        local: {
          stdout: 'hello',
          diagnostics: {
            kind: 'formax.context_diagnostics',
            schemaVersion: 2,
            mode: 'normal',
          },
        },
      }).localDiagnostics,
    ).toBeNull()

    expect(
      parseTurnStartLikeResponse({
        turn: { id: 'turn-1' },
        local: {
          stdout: 'hello',
          diagnostics: {
            kind: 'formax.context_diagnostics',
            schemaVersion: 1,
            mode: 'normal',
            model: 'claude-3-5-sonnet-latest',
            latestCompactBoundary: null,
            latestReactiveCompact: {
              triggerKind: 'maximum_context_length',
              strategy: 'bad',
            },
            snapshot: {
              totalTokens: 1,
              systemTokens: 1,
              historyTokens: 0,
              toolResultTokens: 0,
              otherHistoryTokens: 0,
              messageCount: 1,
              userMessageCount: 1,
              assistantMessageCount: 0,
              toolResultBlockCount: 0,
              microCompactedToolResultCount: 0,
              toolResultCountsByToolName: [],
              microCompactedCountsByToolName: [],
              contextWindowTokens: null,
              effectiveLimitTokens: null,
              autoCompactLimitTokens: null,
              baselineTokens: null,
              percentRemaining: null,
              remainingToEffectiveLimit: null,
              remainingToAutoCompactLimit: null,
              shouldAutoCompact: null,
              topSnapshotContributors: [],
            },
            nextTurnFixed: {
              fixedGroups: [],
              microCompactImpact: {
                compactedBlocks: 0,
                compactedToolNames: [],
                estimatedTokensSaved: 0,
                keptRecentBlocks: 0,
              },
              projectedHistoryTokens: 0,
              projectedHistoryDeltaTokens: 0,
              fixedTokens: 0,
              totalTokens: 0,
              remainingToEffectiveLimit: null,
              remainingToAutoCompactLimit: null,
              shouldAutoCompact: null,
              topAssembledContributors: [],
            },
            notes: [],
          },
        },
      }).localDiagnostics,
    ).toBeNull()

    expect(
      parseTurnStartLikeResponse({
        turn: { id: 'turn-1' },
        local: {
          stdout: 'hello',
          diagnostics: {
            kind: 'formax.context_diagnostics',
            schemaVersion: 1,
            mode: 'normal',
            model: 'claude-3-5-sonnet-latest',
            latestCompactBoundary: null,
            snapshot: {
              totalTokens: 1,
              systemTokens: 1,
              historyTokens: 0,
              toolResultTokens: 0,
              otherHistoryTokens: 0,
              messageCount: 1,
              userMessageCount: 1,
              assistantMessageCount: 0,
              toolResultBlockCount: 0,
              microCompactedToolResultCount: 0,
              toolResultCountsByToolName: [],
              microCompactedCountsByToolName: [],
              contextWindowTokens: null,
              effectiveLimitTokens: null,
              autoCompactLimitTokens: null,
              baselineTokens: null,
              percentRemaining: null,
              remainingToEffectiveLimit: null,
              remainingToAutoCompactLimit: null,
              shouldAutoCompact: null,
              topSnapshotContributors: [],
            },
            nextTurnFixed: {
              fixedGroups: [],
              assembledLedger: [{ kind: 'system_total', key: 'system_total', label: 'bad', tokens: 'oops' }],
              strategyCoordination: [
                {
                  stage: 'microcompact',
                  role: 'budget_reducer',
                  scope: 'persisted_history_candidate',
                  disposition: 'applied',
                  terminal: false,
                  advisory: true,
                  reason: 'bad',
                  estimatedTokensSaved: 'oops',
                  inputTokens: 1,
                  outputTokens: 1,
                },
              ],
              microCompactImpact: {
                compactedBlocks: 0,
                compactedToolNames: [],
                estimatedTokensSaved: 0,
                keptRecentBlocks: 0,
              },
              projectedHistoryTokens: 0,
              projectedHistoryDeltaTokens: 0,
              fixedTokens: 0,
              totalTokens: 0,
              remainingToEffectiveLimit: null,
              remainingToAutoCompactLimit: null,
              shouldAutoCompact: null,
              topAssembledContributors: [],
            },
            notes: [],
          },
        },
      }).localDiagnostics,
    ).toBeNull()

    expect(
      parseTurnStartLikeResponse({
        turn: { id: 'turn-1' },
        local: {
          stdout: 'hello',
          diagnostics: {
            kind: 'formax.context_diagnostics',
            schemaVersion: 1,
            mode: 'normal',
            model: 'claude-3-5-sonnet-latest',
            latestCompactBoundary: null,
            snapshot: {
              totalTokens: 1,
              systemTokens: 1,
              historyTokens: 0,
              toolResultTokens: 0,
              otherHistoryTokens: 0,
              messageCount: 1,
              userMessageCount: 1,
              assistantMessageCount: 0,
              toolResultBlockCount: 0,
              microCompactedToolResultCount: 0,
              toolResultCountsByToolName: [],
              microCompactedCountsByToolName: [],
              contextWindowTokens: null,
              effectiveLimitTokens: null,
              autoCompactLimitTokens: null,
              baselineTokens: null,
              percentRemaining: null,
              remainingToEffectiveLimit: null,
              remainingToAutoCompactLimit: null,
              shouldAutoCompact: null,
              topSnapshotContributors: [{ kind: 'collapse-oops', label: 'bad', tokens: 1 }],
            },
            nextTurnFixed: {
              fixedGroups: [],
              microCompactImpact: {
                compactedBlocks: 0,
                compactedToolNames: [],
                estimatedTokensSaved: 0,
                keptRecentBlocks: 0,
              },
              projectedHistoryTokens: 0,
              projectedHistoryDeltaTokens: 0,
              fixedTokens: 0,
              totalTokens: 0,
              remainingToEffectiveLimit: null,
              remainingToAutoCompactLimit: null,
              shouldAutoCompact: null,
              topAssembledContributors: [],
            },
            notes: [],
          },
        },
      }).localDiagnostics,
    ).toBeNull()

    expect(
      parseTurnStartLikeResponse({
        turn: { id: 'turn-1' },
        local: {
          stdout: 'hello',
          diagnostics: {
            kind: 'formax.context_diagnostics',
            schemaVersion: 1,
            mode: 'normal',
            model: 'claude-3-5-sonnet-latest',
            latestCompactBoundary: null,
            snapshot: {
              totalTokens: 1,
              systemTokens: 1,
              historyTokens: 0,
              toolResultTokens: 0,
              otherHistoryTokens: 0,
              messageCount: 1,
              userMessageCount: 1,
              assistantMessageCount: 0,
              toolResultBlockCount: 0,
              microCompactedToolResultCount: 0,
              toolResultCountsByToolName: [],
              microCompactedCountsByToolName: [],
              contextWindowTokens: null,
              effectiveLimitTokens: null,
              autoCompactLimitTokens: null,
              baselineTokens: null,
              percentRemaining: null,
              remainingToEffectiveLimit: null,
              remainingToAutoCompactLimit: null,
              shouldAutoCompact: null,
              topSnapshotContributors: [],
            },
            nextTurnFixed: {
              fixedGroups: [],
              microCompactImpact: {
                compactedBlocks: 0,
                compactedToolNames: [],
                estimatedTokensSaved: 0,
                keptRecentBlocks: 0,
              },
              collapseImpact: {
                collapsed: 'bad',
                collapsedHeadMessageCount: 0,
                estimatedTokensSaved: 0,
                projectedHistoryTokensAfterCollapse: 0,
                projectedHistoryDeltaTokens: 0,
              },
              projectedHistoryTokens: 0,
              projectedHistoryDeltaTokens: 0,
              fixedTokens: 0,
              totalTokens: 0,
              remainingToEffectiveLimit: null,
              remainingToAutoCompactLimit: null,
              shouldAutoCompact: null,
              topAssembledContributors: [],
            },
            notes: [],
          },
        },
      }).localDiagnostics,
    ).toBeNull()

    expect(
      parseTurnStartLikeResponse({
        turn: { id: 'turn-1' },
        local: {
          stdout: 'hello',
          diagnostics: {
            kind: 'formax.context_diagnostics',
            schemaVersion: 1,
            mode: 'normal',
            model: 'claude-3-5-sonnet-latest',
            latestCompactBoundary: null,
            snapshot: {
              totalTokens: 1,
              systemTokens: 1,
              historyTokens: 0,
              toolResultTokens: 0,
              otherHistoryTokens: 0,
              messageCount: 1,
              userMessageCount: 1,
              assistantMessageCount: 0,
              toolResultBlockCount: 0,
              microCompactedToolResultCount: 0,
              toolResultCountsByToolName: [],
              microCompactedCountsByToolName: [],
              contextWindowTokens: null,
              effectiveLimitTokens: null,
              autoCompactLimitTokens: null,
              baselineTokens: null,
              percentRemaining: null,
              remainingToEffectiveLimit: null,
              remainingToAutoCompactLimit: null,
              shouldAutoCompact: null,
              topSnapshotContributors: [],
            },
            nextTurnFixed: {
              fixedGroups: [],
              microCompactImpact: {
                compactedBlocks: 0,
                compactedToolNames: [],
                estimatedTokensSaved: 0,
                keptRecentBlocks: 0,
              },
              lifecycleMarkers: ['bad'],
              projectedHistoryTokens: 0,
              projectedHistoryDeltaTokens: 0,
              fixedTokens: 0,
              totalTokens: 0,
              remainingToEffectiveLimit: null,
              remainingToAutoCompactLimit: null,
              shouldAutoCompact: null,
              topAssembledContributors: [],
            },
            notes: [],
          },
        },
      }).localDiagnostics,
    ).toBeNull()

    expect(
      parseTurnStartLikeResponse({
        turn: { id: 'turn-1' },
        local: {
          stdout: 'hello',
          diagnostics: {
            kind: 'formax.context_diagnostics',
            schemaVersion: 1,
            mode: 'normal',
            model: 'claude-3-5-sonnet-latest',
            snapshot: {},
          },
        },
      }).localDiagnostics,
    ).toBeNull()

    expect(
      parseTurnStartLikeResponse({
        turn: { id: 'turn-1' },
        local: {
          stdout: 'hello',
          diagnostics: {
            kind: 'formax.context_diagnostics',
            schemaVersion: 1,
            mode: 'normal',
            model: 'claude-3-5-sonnet-latest',
            latestCompactBoundary: { schemaVersion: 2 },
            snapshot: {
              totalTokens: 1,
              systemTokens: 1,
              historyTokens: 0,
              toolResultTokens: 0,
              otherHistoryTokens: 0,
              messageCount: 1,
              userMessageCount: 1,
              assistantMessageCount: 0,
              toolResultBlockCount: 0,
              microCompactedToolResultCount: 0,
              toolResultCountsByToolName: [],
              microCompactedCountsByToolName: [],
              contextWindowTokens: null,
              effectiveLimitTokens: null,
              autoCompactLimitTokens: 'bad',
              baselineTokens: null,
              percentRemaining: null,
              remainingToEffectiveLimit: null,
              remainingToAutoCompactLimit: null,
              shouldAutoCompact: null,
              topSnapshotContributors: [],
            },
            nextTurnFixed: {
              fixedGroups: [],
              microCompactImpact: {
                compactedBlocks: 0,
                compactedToolNames: [],
                estimatedTokensSaved: 0,
                keptRecentBlocks: 0,
              },
              projectedHistoryTokens: 0,
              projectedHistoryDeltaTokens: 0,
              fixedTokens: 0,
              totalTokens: 0,
              remainingToEffectiveLimit: null,
              remainingToAutoCompactLimit: null,
              shouldAutoCompact: null,
              topAssembledContributors: [],
            },
            notes: 'bad',
          },
        },
      }).localDiagnostics,
    ).toBeNull()

    expect(
      parseTurnStartLikeResponse({
        turn: { id: 'turn-1' },
        local: {
          stdout: 'hello',
          diagnostics: {
            kind: 'formax.context_diagnostics',
            schemaVersion: 1,
            mode: 'normal',
            model: 'claude-3-5-sonnet-latest',
            latestCompactBoundary: null,
            snapshot: {
              totalTokens: 1,
              systemTokens: 1,
              historyTokens: 0,
              toolResultTokens: 0,
              otherHistoryTokens: 0,
              messageCount: 1,
              userMessageCount: 1,
              assistantMessageCount: 0,
              toolResultBlockCount: 0,
              microCompactedToolResultCount: 0,
              toolResultCountsByToolName: [],
              microCompactedCountsByToolName: [],
              contextWindowTokens: null,
              effectiveLimitTokens: null,
              autoCompactLimitTokens: null,
              baselineTokens: null,
              percentRemaining: null,
              remainingToEffectiveLimit: null,
              remainingToAutoCompactLimit: null,
              shouldAutoCompact: null,
              topSnapshotContributors: [],
            },
            nextTurnFixed: {
              fixedGroups: [],
              microCompactImpact: {
                compactedBlocks: 0,
                estimatedTokensSaved: 0,
                keptRecentBlocks: 0,
              },
              projectedHistoryTokens: 0,
              projectedHistoryDeltaTokens: 0,
              fixedTokens: 0,
              totalTokens: 0,
              remainingToEffectiveLimit: null,
              remainingToAutoCompactLimit: null,
              shouldAutoCompact: null,
              topAssembledContributors: [],
            },
            notes: [],
          },
        },
      }).localDiagnostics,
    ).toBeNull()

    expect(
      parseTurnStartLikeResponse({
        turn: { id: 'turn-1' },
        local: {
          stdout: 'hello',
          diagnostics: {
            kind: 'formax.context_diagnostics',
            schemaVersion: 1,
            mode: 'normal',
            model: 'claude-3-5-sonnet-latest',
            latestCompactBoundary: null,
            snapshot: {
              totalTokens: 1,
              systemTokens: 1,
              systemSectionBreakdown: 'bad',
              historyTokens: 0,
              toolResultTokens: 0,
              otherHistoryTokens: 0,
              messageCount: 1,
              userMessageCount: 1,
              assistantMessageCount: 0,
              toolResultBlockCount: 0,
              microCompactedToolResultCount: 0,
              toolResultCountsByToolName: [],
              microCompactedCountsByToolName: [],
              contextWindowTokens: null,
              effectiveLimitTokens: null,
              autoCompactLimitTokens: null,
              baselineTokens: null,
              percentRemaining: null,
              remainingToEffectiveLimit: null,
              remainingToAutoCompactLimit: null,
              shouldAutoCompact: null,
              topSnapshotContributors: [],
            },
            nextTurnFixed: {
              fixedGroups: [],
              microCompactImpact: {
                compactedBlocks: 0,
                compactedToolNames: [],
                estimatedTokensSaved: 0,
                keptRecentBlocks: 0,
              },
              projectedHistoryTokens: 0,
              projectedHistoryDeltaTokens: 0,
              fixedTokens: 0,
              totalTokens: 0,
              remainingToEffectiveLimit: null,
              remainingToAutoCompactLimit: null,
              shouldAutoCompact: null,
              topAssembledContributors: [],
            },
            notes: [],
          },
        },
      }).localDiagnostics,
    ).toBeNull()

    expect(
      parseTurnStartLikeResponse({
        turn: { id: 'turn-1' },
        local: {
          stdout: 'hello',
          diagnostics: {
            kind: 'formax.context_diagnostics',
            schemaVersion: 1,
            mode: 'normal',
            model: 'claude-3-5-sonnet-latest',
            latestCompactBoundary: {
              schemaVersion: 1,
              trigger: 'auto',
              triggerReason: { kind: 'bad-kind' },
            },
            snapshot: {
              totalTokens: 1,
              systemTokens: 1,
              historyTokens: 0,
              toolResultTokens: 0,
              otherHistoryTokens: 0,
              messageCount: 1,
              userMessageCount: 1,
              assistantMessageCount: 0,
              toolResultBlockCount: 0,
              microCompactedToolResultCount: 0,
              toolResultCountsByToolName: [],
              microCompactedCountsByToolName: [],
              contextWindowTokens: null,
              effectiveLimitTokens: null,
              autoCompactLimitTokens: null,
              baselineTokens: null,
              percentRemaining: null,
              remainingToEffectiveLimit: null,
              remainingToAutoCompactLimit: null,
              shouldAutoCompact: null,
              topSnapshotContributors: [],
            },
            nextTurnFixed: {
              fixedGroups: [],
              microCompactImpact: {
                compactedBlocks: 0,
                compactedToolNames: [],
                estimatedTokensSaved: 0,
                keptRecentBlocks: 0,
              },
              projectedHistoryTokens: 0,
              projectedHistoryDeltaTokens: 0,
              fixedTokens: 0,
              totalTokens: 0,
              remainingToEffectiveLimit: null,
              remainingToAutoCompactLimit: null,
              shouldAutoCompact: null,
              topAssembledContributors: [],
            },
            notes: [],
          },
        },
      }).localDiagnostics,
    ).toBeNull()

    expect(
      parseTurnStartLikeResponse({
        turn: { id: 'turn-1' },
        local: {
          stdout: 'hello',
          diagnostics: {
            kind: 'formax.context_diagnostics',
            schemaVersion: 1,
            mode: 'normal',
            model: 'claude-3-5-sonnet-latest',
            latestCompactBoundary: null,
            latestRequestCollapse: {
              phase: 'broken',
              collapsedHeadMessageCount: 1,
              estimatedTokensSaved: 2,
            },
            snapshot: {
              totalTokens: 1,
              systemTokens: 1,
              historyTokens: 0,
              toolResultTokens: 0,
              otherHistoryTokens: 0,
              messageCount: 1,
              userMessageCount: 1,
              assistantMessageCount: 0,
              toolResultBlockCount: 0,
              microCompactedToolResultCount: 0,
              toolResultCountsByToolName: [],
              microCompactedCountsByToolName: [],
              contextWindowTokens: null,
              effectiveLimitTokens: null,
              autoCompactLimitTokens: null,
              baselineTokens: null,
              percentRemaining: null,
              remainingToEffectiveLimit: null,
              remainingToAutoCompactLimit: null,
              shouldAutoCompact: null,
              topSnapshotContributors: [],
            },
            nextTurnFixed: {
              fixedGroups: [],
              microCompactImpact: {
                compactedBlocks: 0,
                compactedToolNames: [],
                estimatedTokensSaved: 0,
                keptRecentBlocks: 0,
              },
              projectedHistoryTokens: 0,
              projectedHistoryDeltaTokens: 0,
              fixedTokens: 0,
              totalTokens: 0,
              remainingToEffectiveLimit: null,
              remainingToAutoCompactLimit: null,
              shouldAutoCompact: null,
              topAssembledContributors: [],
            },
            notes: [],
          },
        },
      }).localDiagnostics,
    ).toBeNull()
  })

  it('keeps diagnostics backward-compatible when contributor identity fields are absent', () => {
    expect(
      parseTurnStartLikeResponse({
        turn: { id: 'turn-1' },
        local: {
          stdout: 'hello',
          diagnostics: {
            kind: 'formax.context_diagnostics',
            schemaVersion: 1,
            mode: 'normal',
            model: 'claude-3-5-sonnet-latest',
            latestCompactBoundary: null,
            snapshot: {
              totalTokens: 1,
              systemTokens: 1,
              historyTokens: 0,
              toolResultTokens: 0,
              otherHistoryTokens: 0,
              messageCount: 1,
              userMessageCount: 1,
              assistantMessageCount: 0,
              toolResultBlockCount: 0,
              microCompactedToolResultCount: 0,
              toolResultCountsByToolName: [],
              microCompactedCountsByToolName: [],
              contextWindowTokens: null,
              effectiveLimitTokens: null,
              autoCompactLimitTokens: null,
              baselineTokens: null,
              percentRemaining: null,
              remainingToEffectiveLimit: null,
              remainingToAutoCompactLimit: null,
              shouldAutoCompact: null,
              topSnapshotContributors: [{ label: 'bad', tokens: 1 }],
            },
            nextTurnFixed: {
              fixedGroups: [],
              microCompactImpact: {
                compactedBlocks: 0,
                compactedToolNames: [],
                estimatedTokensSaved: 0,
                keptRecentBlocks: 0,
              },
              projectedHistoryTokens: 0,
              projectedHistoryDeltaTokens: 0,
              fixedTokens: 0,
              totalTokens: 0,
              remainingToEffectiveLimit: null,
              remainingToAutoCompactLimit: null,
              shouldAutoCompact: null,
              topAssembledContributors: [],
            },
            notes: [],
          },
        },
      }).localDiagnostics,
    ).toMatchObject({
      snapshot: {
        topSnapshotContributors: [{ label: 'bad', tokens: 1 }],
      },
    })
  })

  it('rejects malformed contributor identity fields when they are explicitly present', () => {
    expect(
      parseTurnStartLikeResponse({
        turn: { id: 'turn-1' },
        local: {
          stdout: 'hello',
          diagnostics: {
            kind: 'formax.context_diagnostics',
            schemaVersion: 1,
            mode: 'normal',
            model: 'claude-3-5-sonnet-latest',
            latestCompactBoundary: null,
            snapshot: {
              totalTokens: 1,
              systemTokens: 1,
              historyTokens: 0,
              toolResultTokens: 0,
              otherHistoryTokens: 0,
              messageCount: 1,
              userMessageCount: 1,
              assistantMessageCount: 0,
              toolResultBlockCount: 0,
              microCompactedToolResultCount: 0,
              toolResultCountsByToolName: [],
              microCompactedCountsByToolName: [],
              contextWindowTokens: null,
              effectiveLimitTokens: null,
              autoCompactLimitTokens: null,
              baselineTokens: null,
              percentRemaining: null,
              remainingToEffectiveLimit: null,
              remainingToAutoCompactLimit: null,
              shouldAutoCompact: null,
              topSnapshotContributors: [{ kind: 'bad-kind', label: 'bad', tokens: 1 }],
            },
            nextTurnFixed: {
              fixedGroups: [],
              microCompactImpact: {
                compactedBlocks: 0,
                compactedToolNames: [],
                estimatedTokensSaved: 0,
                keptRecentBlocks: 0,
              },
              projectedHistoryTokens: 0,
              projectedHistoryDeltaTokens: 0,
              fixedTokens: 0,
              totalTokens: 0,
              remainingToEffectiveLimit: null,
              remainingToAutoCompactLimit: null,
              shouldAutoCompact: null,
              topAssembledContributors: [],
            },
            notes: [],
          },
        },
      }).localDiagnostics,
    ).toBeNull()
  })

  it('preserves explicit null skip reasons instead of collapsing them to missing fields', () => {
    expect(
      parseTurnStartLikeResponse({
        turn: { id: 'turn-1' },
        local: {
          stdout: 'hello',
          diagnostics: {
            kind: 'formax.context_diagnostics',
            schemaVersion: 1,
            mode: 'normal',
            model: 'claude-3-5-sonnet-latest',
            latestCompactBoundary: null,
            snapshot: {
              totalTokens: 1,
              systemTokens: 1,
              historyTokens: 0,
              toolResultTokens: 0,
              otherHistoryTokens: 0,
              messageCount: 1,
              userMessageCount: 1,
              assistantMessageCount: 0,
              toolResultBlockCount: 0,
              microCompactedToolResultCount: 0,
              toolResultCountsByToolName: [],
              microCompactedCountsByToolName: [],
              contextWindowTokens: null,
              effectiveLimitTokens: null,
              autoCompactLimitTokens: null,
              baselineTokens: null,
              percentRemaining: null,
              remainingToEffectiveLimit: null,
              remainingToAutoCompactLimit: null,
              shouldAutoCompact: null,
              topSnapshotContributors: [],
            },
            nextTurnFixed: {
              fixedGroups: [],
              microCompactImpact: {
                compactedBlocks: 0,
                compactedToolNames: [],
                estimatedTokensSaved: 0,
                keptRecentBlocks: 0,
              },
              projectedHistoryTokens: 0,
              projectedHistoryDeltaTokens: 0,
              fixedTokens: 0,
              totalTokens: 0,
              remainingToEffectiveLimit: null,
              remainingToAutoCompactLimit: null,
              shouldAutoCompact: null,
              autoCompactSkipReason: null,
              pruneSkipReason: null,
              topAssembledContributors: [],
            },
            notes: [],
          },
        },
      }).localDiagnostics?.nextTurnFixed,
    ).toMatchObject({
      autoCompactSkipReason: null,
      pruneSkipReason: null,
    })
  })

  it('parses turn/input/submit response status with unknown fallback', () => {
    expect(parseInputSubmitResponse({ status: 'submitted' })).toEqual({ status: 'submitted' })
    expect(parseInputSubmitResponse({ status: '' })).toEqual({ status: 'unknown' })
    expect(parseInputSubmitResponse({})).toEqual({ status: 'unknown' })
  })

  it('parses thread/replay response via canonical replay parser', () => {
    const replay = parseThreadReplayResponse({
      data: [{ replaySeq: 7, method: 'turn/event', params: { ok: true } }],
      nextCursor: 8,
      latestCursor: 9,
      hasGap: false,
    })

    expect(replay.data).toHaveLength(1)
    expect(replay.nextCursor).toBe(8)
    expect(replay.latestCursor).toBe(9)
    expect(replay.hasGap).toBe(false)
  })

  it('parses thread/list and thread/messages payloads via shared parser contracts', () => {
    const threads = parseThreadListResponse({
      data: [{ id: 'thread-1', cwd: '/repo', createdAt: 'a', updatedAt: 'b', messageCount: 1, lastUserPrompt: null, label: null }],
    })
    expect(threads).toHaveLength(1)
    expect(threads[0]?.id).toBe('thread-1')

    const messages = parseThreadMessagesResponse({
      data: [{ id: 'm1', kind: 'message', role: 'assistant', text: 'hello' }],
      nextCursor: 'cursor-1',
      latestCompactBoundary: {
        schemaVersion: 1,
        trigger: 'auto',
        triggerReason: { kind: 'auto_threshold' },
        preTokens: 1024,
        summaryKind: 'session_memory',
      },
      latestRequestCollapse: {
        phase: 'initial',
        collapsedHeadMessageCount: 2,
        estimatedTokensSaved: 64,
        recapFingerprint: 'fedcba9876543210',
      },
    })
    expect(messages.data).toHaveLength(1)
    expect(messages.nextCursor).toBe('cursor-1')
    expect(messages.latestCompactBoundary).toEqual({
      schemaVersion: 1,
      trigger: 'auto',
      triggerReason: { kind: 'auto_threshold' },
      preTokens: 1024,
      summaryKind: 'session_memory',
    })
    expect(messages.latestRequestCollapse).toEqual({
      phase: 'initial',
      collapsedHeadMessageCount: 2,
      estimatedTokensSaved: 64,
      recapFingerprint: 'fedcba9876543210',
    })
  })

  it('parses thread/read payload with optional latest request collapse summary', () => {
    expect(
      parseThreadReadResponse({
        thread: {
          id: 'thread-1',
          cwd: '/repo',
          createdAt: '2026-04-07T00:00:00.000Z',
          updatedAt: '2026-04-07T00:01:00.000Z',
        },
        transcriptPreview: [{ role: 'user', text: 'hello' }],
        latestCompactBoundary: {
          schemaVersion: 1,
          trigger: 'manual',
          preTokens: 900,
          summaryKind: 'model_summary',
        },
        latestRequestCollapse: {
          phase: 'reactive_retry',
          collapsedHeadMessageCount: 3,
          estimatedTokensSaved: 120,
          recapFingerprint: 'abcdef0123456789',
        },
      }),
    ).toEqual({
      thread: {
        id: 'thread-1',
        cwd: '/repo',
        createdAt: '2026-04-07T00:00:00.000Z',
        updatedAt: '2026-04-07T00:01:00.000Z',
      },
      transcriptPreview: [{ role: 'user', text: 'hello' }],
      latestCompactBoundary: {
        schemaVersion: 1,
        trigger: 'manual',
        preTokens: 900,
        summaryKind: 'model_summary',
      },
      latestRequestCollapse: {
        phase: 'reactive_retry',
        collapsedHeadMessageCount: 3,
        estimatedTokensSaved: 120,
        recapFingerprint: 'abcdef0123456789',
      },
    })
  })

  it('parses thread/resume payload with latest compact boundary summary', () => {
    expect(
      parseThreadResumeResponse({
        thread: {
          id: 'thread-1',
          cwd: '/repo',
          createdAt: '2026-05-12T00:00:00.000Z',
          updatedAt: '2026-05-12T00:01:00.000Z',
        },
        staleInputs: [],
        latestCompactBoundary: {
          schemaVersion: 1,
          trigger: 'reactive',
          triggerReason: {
            kind: 'reactive_error',
            detail: 'maximum context length exceeded',
          },
          preTokens: 1400,
          summaryKind: 'model_summary',
        },
      }),
    ).toEqual({
      thread: {
        id: 'thread-1',
        cwd: '/repo',
        createdAt: '2026-05-12T00:00:00.000Z',
        updatedAt: '2026-05-12T00:01:00.000Z',
      },
      staleInputs: [],
      latestCompactBoundary: {
        schemaVersion: 1,
        trigger: 'reactive',
        triggerReason: {
          kind: 'reactive_error',
          detail: 'maximum context length exceeded',
        },
        preTokens: 1400,
        summaryKind: 'model_summary',
      },
    })
  })

  it('rejects malformed explicit latest request collapse in thread/read payload', () => {
    expect(
      parseThreadReadResponse({
        thread: {
          id: 'thread-1',
          cwd: '/repo',
          createdAt: '2026-04-07T00:00:00.000Z',
          updatedAt: '2026-04-07T00:01:00.000Z',
        },
        transcriptPreview: [],
        latestCompactBoundary: {
          schemaVersion: 2,
        },
        latestRequestCollapse: {
          phase: 'initial',
          collapsedHeadMessageCount: 3,
          estimatedTokensSaved: 'bad',
        },
      }),
    ).toBeNull()
  })

  it('parses stale resolved inputs via shared parser contract', () => {
    const resolved = parseResolvedInputsResponse({
      staleInputs: [
        {
          inputId: 'input-1',
          threadId: 'thread-1',
          turnId: 'turn-1',
          toolUseId: 'tool-1',
          kind: 'approval',
          status: 'submitted',
          createdAt: '2026-02-20T00:00:00.000Z',
          expiresAt: '2026-02-20T00:01:00.000Z',
          resolvedAt: '2026-02-20T00:00:30.000Z',
        },
      ],
    })

    expect(resolved).toHaveLength(1)
    expect(resolved[0]?.inputId).toBe('input-1')
  })
})
