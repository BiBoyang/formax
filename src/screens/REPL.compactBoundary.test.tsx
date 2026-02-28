import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render } from 'ink-testing-library'
import type { RuntimeConfig } from '../env/config'

let mockState: any
let mockActions: any

vi.mock('../features/repl/useReplController', async () => {
  const actual = (await vi.importActual('../features/repl/useReplController')) as Record<string, unknown>
  return {
    ...actual,
    useReplController: () => ({ state: mockState, actions: mockActions }),
  }
})

const cfg: RuntimeConfig = {
  llm: {
    provider: 'anthropic',
    baseUrl: '',
    apiKey: '',
    model: '',
    timeoutMs: 600000,
    thinkingMode: true,
  },
  paths: {
    logsDir: '',
    subagentsDir: '',
    planDir: '',
  },
  context: {
    effectiveContextWindowPercent: 0.95,
    autoCompactTokenLimitPercent: 0.9,
    baselineTokens: 12000,
    compactKeepLastTurns: 4,
    enableAutoCompact: true,
    autoCompactMinTurnsBetweenRuns: 8,
  },
  ui: {
    assistantTextMode: 'stream',
    promptProfile: 'lite',
    showContextMeter: true,
    showAutoCompactNotice: true,
    outputStyle: 'default',
    verboseOutput: false,
  },
}

describe('REPL compact boundary rendering', () => {
  it('handles assistant compact_boundary rows without rendering visible message text', async () => {
    mockActions = {
      send: vi.fn(),
      abort: vi.fn(),
      closeAgentsDialog: vi.fn(),
      closePermissionsDialog: vi.fn(),
      closeHooksDialog: vi.fn(),
      closeConfigDialog: vi.fn(),
      closeModelDialog: vi.fn(),
      closeResumeDialog: vi.fn(),
      generateAgentDraft: vi.fn(),
      saveAgentFromDialog: vi.fn(),
      resumeSession: vi.fn(),
      renameSession: vi.fn(),
    }

    mockState = {
      staticMessages: [
        { role: 'assistant', content: 'boundary-text', ui: { kind: 'compact_boundary' } },
      ],
      transientMessages: [],
      transcriptSeq: 1,
      isLoading: false,
      loadingText: '',
      thinkingText: '',
      thinkingStartedAtMs: null,
      error: null,
      context: null,
      allowedSubagents: [],
      agentsDialogOpen: false,
      permissionsDialogOpen: false,
      hooksDialogOpen: false,
      configDialogOpen: false,
      modelDialogOpen: false,
      resumeDialogOpen: false,
    }

    const { REPL } = await import('./REPL')
    const { lastFrame } = render(<REPL engine={{ runTurn: async ({ history }: any) => history }} tools={[]} cfg={cfg} />)
    const frame = lastFrame() || ''
    expect(frame).toContain('Try "fix typecheck errors"')
    expect(frame).not.toContain('boundary-text')
  })
})
