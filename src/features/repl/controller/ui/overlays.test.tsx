import React, { useMemo, useState } from 'react'
import { Box, Text } from 'ink'
import { render } from 'ink-testing-library'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChatEngine } from '../../../../chat/engine.js'
import type { Msg } from '../../../../shared/toolMessageTypes'
import type { OverlaySpec } from '../../../commands/contracts.js'
import { useReplOverlays } from './overlays.js'

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

async function waitForApiRef(apiRef: { current: HarnessApi | null }, timeoutMs = 3000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (apiRef.current) return
    await tick()
  }
  throw new Error('Timed out waiting for Harness apiRef to be populated')
}

async function waitForText(
  lastFrame: () => string | undefined,
  text: string,
  timeoutMs = 3000,
): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const frame = lastFrame() || ''
    if (frame.includes(text)) return
    await tick()
  }
  const finalFrame = lastFrame() || ''
  throw new Error(`Timed out waiting for UI to contain: ${text}\n\nLast frame:\n${finalFrame}`)
}

vi.mock('../../../subagents/agentsWizard', () => {
  return {
    generateAgentDraftWithClaude: vi.fn(async () => {
      return {
        name: 'draft-agent',
        description: 'draft-desc',
        systemPrompt: 'draft-system',
      }
    }),
    createAgentFromWizardAnswers: vi.fn(async () => {
      return { name: 'my-agent', filePath: '/tmp/my-agent.md' }
    }),
  }
})

vi.mock('../../overlays/OverlayManager', () => {
  const unsubscribes: Array<ReturnType<typeof vi.fn>> = []

  return {
    createOverlayManager: (initial: OverlaySpec | null = null) => {
      let overlay: OverlaySpec | null = initial
      const listeners = new Set<(next: OverlaySpec | null) => void>()

      const notify = () => {
        for (const fn of listeners) fn(overlay)
      }

      return {
        open: (spec: OverlaySpec) => {
          overlay = spec
          notify()
        },
        close: () => {
          overlay = null
          notify()
        },
        current: () => overlay,
        subscribe: (listener: (next: OverlaySpec | null) => void) => {
          listeners.add(listener)
          const unsubscribe = vi.fn(() => {
            listeners.delete(listener)
          })
          unsubscribes.push(unsubscribe)
          return unsubscribe
        },
      }
    },
    __test: {
      reset: () => {
        unsubscribes.length = 0
      },
      getUnsubscribes: () => unsubscribes,
    },
  }
})

type HarnessApi = {
  getOverlay: () => OverlaySpec | null
  getMessages: () => Msg[]
  openOverlay: (spec: OverlaySpec) => void
  closeOverlay: () => void
  closeAgentsDialog: (args: { createdAgents: string[] }) => void
  closePermissionsDialog: () => void
  closeHooksDialog: () => void
  closeConfigDialog: (exit: { kind: 'dismissed' } | { kind: 'changed'; message: string }) => void
  closeModelDialog: (exit: { kind: 'dismissed' } | { kind: 'changed'; message: string }) => void
  closeResumeDialog: (exit?: { kind: 'dismissed' }) => void
  generateAgentDraft: (description: string, signal?: AbortSignal) => Promise<any>
  saveAgentFromDialog: (args: any) => Promise<any>
}

function Harness(props: {
  apiRef: { current: HarnessApi | null }
  initialOverlay?: OverlaySpec | null
  reloadSubagents?: () => Promise<Array<{ name: string; description: string }>>
  initialMessages?: Msg[]
}) {
  const initialOverlay = props.initialOverlay ?? null
  const [messages, setMessagesState] = useState<Msg[]>(props.initialMessages ?? [])
  const setMessages = (updater: (prev: Msg[]) => Msg[]) => setMessagesState((prev) => updater(prev))

  const [allowedSubagents, setAllowedSubagents] = useState<Array<{ name: string; description: string }>>([])

  const engine = useMemo(() => ({} as ChatEngine), [])

  const overlayApi = useReplOverlays({
    engine,
    projectAgentsDir: '/tmp/project/.formax/agents',
    reloadSubagents: props.reloadSubagents,
    setAllowedSubagents: (next) => {
      setAllowedSubagents(next)
    },
    setMessages,
    initialOverlay,
  })

  props.apiRef.current = {
    getOverlay: () => overlayApi.overlay,
    getMessages: () => messages,
    openOverlay: overlayApi.openOverlay,
    closeOverlay: overlayApi.closeOverlay,
    closeAgentsDialog: overlayApi.closeAgentsDialog,
    closePermissionsDialog: overlayApi.closePermissionsDialog,
    closeHooksDialog: overlayApi.closeHooksDialog,
    closeConfigDialog: overlayApi.closeConfigDialog,
    closeModelDialog: overlayApi.closeModelDialog,
    closeResumeDialog: overlayApi.closeResumeDialog,
    generateAgentDraft: overlayApi.generateAgentDraft,
    saveAgentFromDialog: overlayApi.saveAgentFromDialog,
  }

  return (
    <Box flexDirection='column'>
      <Text>overlay={overlayApi.overlay ? overlayApi.overlay.kind : 'none'}</Text>
      <Text>allowed={allowedSubagents.map((a) => a.name).join(',')}</Text>
      <Text>
        log=
        {(() => {
          const lines: string[] = []
          for (const msg of messages) {
            if (msg.ui?.kind === 'command_subline') {
              lines.push(`  ⎿  ${msg.content}`)
              continue
            }
            lines.push(msg.content)
          }
          return lines.join('\n')
        })()}
      </Text>
    </Box>
  )
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('useReplOverlays', () => {
  it('openOverlay / closeOverlay updates overlay state', async () => {
    const apiRef = { current: null as HarnessApi | null }
    const app = render(<Harness apiRef={apiRef} />)

    expect(app.lastFrame()).toContain('overlay=none')
    await waitForApiRef(apiRef)
    await tick()

    apiRef.current?.openOverlay({ kind: 'agents' })
    await waitForText(app.lastFrame, 'overlay=agents')

    apiRef.current?.closeOverlay()
    await waitForText(app.lastFrame, 'overlay=none')
  })

  it('closeAgentsDialog appends a message (dismissed)', async () => {
    const apiRef = { current: null as HarnessApi | null }
    const app = render(<Harness apiRef={apiRef} initialOverlay={{ kind: 'agents' }} />)

    expect(app.lastFrame()).toContain('overlay=agents')
    await waitForApiRef(apiRef)
    await tick()

    apiRef.current?.closeAgentsDialog({ createdAgents: [] })

    await waitForText(app.lastFrame, 'overlay=none')
    await waitForText(app.lastFrame, 'Agents dialog dismissed')
  })

  it('closeAgentsDialog appends a message (created agents)', async () => {
    const apiRef = { current: null as HarnessApi | null }
    const app = render(<Harness apiRef={apiRef} />)
    await waitForApiRef(apiRef)
    await tick()

    apiRef.current?.closeAgentsDialog({ createdAgents: ['a', 'b'] })

    await waitForText(app.lastFrame, 'Agent changes:')
    await waitForText(app.lastFrame, 'Created agent: a')
    await waitForText(app.lastFrame, 'Created agent: b')
  })

  it('closePermissionsDialog and closeHooksDialog append messages', async () => {
    const apiRef = { current: null as HarnessApi | null }
    const app = render(
      <Harness
        apiRef={apiRef}
        initialMessages={[
          {
            id: 'u1',
            role: 'user',
            content: '/permissions',
            timestamp: new Date(),
          },
        ]}
      />,
    )
    await waitForApiRef(apiRef)
    await tick()

    apiRef.current?.closePermissionsDialog()
    await waitForText(app.lastFrame, 'Permissions dialog dismissed')

    apiRef.current?.closeHooksDialog()
    await waitForText(app.lastFrame, 'Hooks dialog dismissed')
  })

  it('closeResumeDialog appends a message when dismissed', async () => {
    const apiRef = { current: null as HarnessApi | null }
    const app = render(
      <Harness
        apiRef={apiRef}
        initialOverlay={{ kind: 'resume' }}
        initialMessages={[
          {
            id: 'u1',
            role: 'user',
            content: '/resume',
            timestamp: new Date(),
          },
        ]}
      />,
    )
    await waitForApiRef(apiRef)
    await tick()

    apiRef.current?.closeResumeDialog({ kind: 'dismissed' })

    await waitForText(app.lastFrame, 'overlay=none')
    await waitForText(app.lastFrame, 'Resume cancelled')
  })

  it('closeResumeDialog does not append a message by default', async () => {
    const apiRef = { current: null as HarnessApi | null }
    const app = render(
      <Harness
        apiRef={apiRef}
        initialOverlay={{ kind: 'resume' }}
        initialMessages={[
          {
            id: 'u1',
            role: 'user',
            content: '/resume',
            timestamp: new Date(),
          },
        ]}
      />,
    )
    await waitForApiRef(apiRef)
    await tick()

    apiRef.current?.closeResumeDialog()
    await waitForText(app.lastFrame, 'overlay=none')

    const frame = app.lastFrame() || ''
    expect(frame).not.toContain('Resume cancelled')
  })

  it('closeModelDialog appends changed/dismissed messages', async () => {
    const apiRef = { current: null as HarnessApi | null }
    const app = render(
      <Harness
        apiRef={apiRef}
        initialOverlay={{ kind: 'model' }}
        initialMessages={[
          {
            id: 'u1',
            role: 'user',
            content: '/model',
            timestamp: new Date(),
          },
        ]}
      />,
    )
    await waitForApiRef(apiRef)
    await tick()

    apiRef.current?.closeModelDialog({ kind: 'changed', message: 'Set model to Default' })
    await waitForText(app.lastFrame, 'Set model to Default')

    apiRef.current?.openOverlay({ kind: 'model' })
    await waitForText(app.lastFrame, 'overlay=model')

    apiRef.current?.closeModelDialog({ kind: 'dismissed' })
    await waitForText(app.lastFrame, 'Model selection dismissed')
  })

  it('closeConfigDialog appends changed/dismissed messages', async () => {
    const apiRef = { current: null as HarnessApi | null }
    const app = render(
      <Harness
        apiRef={apiRef}
        initialOverlay={{ kind: 'config' }}
        initialMessages={[
          {
            id: 'u1',
            role: 'user',
            content: '/config',
            timestamp: new Date(),
          },
        ]}
      />,
    )
    await waitForApiRef(apiRef)
    await tick()

    apiRef.current?.closeConfigDialog({ kind: 'changed', message: 'Updated config' })
    await waitForText(app.lastFrame, 'Updated config')

    apiRef.current?.openOverlay({ kind: 'config' })
    await waitForText(app.lastFrame, 'overlay=config')
    apiRef.current?.closeConfigDialog({ kind: 'dismissed' })
    await waitForText(app.lastFrame, 'Status dialog dismissed')
  })

  it('generateAgentDraft proxies to wizard generator', async () => {
    const apiRef = { current: null as HarnessApi | null }
    render(<Harness apiRef={apiRef} />)
    await waitForApiRef(apiRef)
    await tick()

    const draft = await apiRef.current!.generateAgentDraft('build me an agent')
    expect(draft).toEqual({
      name: 'draft-agent',
      description: 'draft-desc',
      systemPrompt: 'draft-system',
    })
  })

  it('saveAgentFromDialog triggers reloadSubagents success and openInEditor message', async () => {
    const apiRef = { current: null as HarnessApi | null }
    const reloadSubagents = vi.fn(async () => [{ name: 'x', description: 'X' }])
    const app = render(<Harness apiRef={apiRef} reloadSubagents={reloadSubagents} />)
    await waitForApiRef(apiRef)
    await tick()

    const res = await apiRef.current!.saveAgentFromDialog({
      scope: 'project',
      name: 'n1',
      description: 'd1',
      systemPrompt: 's1',
      tools: ['Read'],
      model: 'inherit',
      color: 'automatic',
      openInEditor: true,
    })

    expect(res).toEqual({ name: 'my-agent', filePath: '/tmp/my-agent.md' })
    expect(reloadSubagents).toHaveBeenCalledTimes(1)
    await waitForText(app.lastFrame, 'allowed=x')
    await waitForText(app.lastFrame, 'Saved agent: my-agent (/tmp/my-agent.md)')
  })

  it('saveAgentFromDialog works when reloadSubagents is not provided', async () => {
    const apiRef = { current: null as HarnessApi | null }
    const app = render(<Harness apiRef={apiRef} />)
    await waitForApiRef(apiRef)
    await tick()

    const res = await apiRef.current!.saveAgentFromDialog({
      scope: 'project',
      name: 'n1',
      description: 'd1',
      systemPrompt: 's1',
      tools: ['Read'],
      model: 'inherit',
      color: 'automatic',
      openInEditor: false,
    })

    expect(res).toEqual({ name: 'my-agent', filePath: '/tmp/my-agent.md' })
    const frame = app.lastFrame() || ''
    expect(frame).toContain('allowed=')
    expect(frame).not.toContain('reload failed')
  })

  it('saveAgentFromDialog handles reloadSubagents error and still returns', async () => {
    const apiRef = { current: null as HarnessApi | null }
    const reloadSubagents = vi.fn(async () => {
      throw new Error('boom')
    })
    const app = render(<Harness apiRef={apiRef} reloadSubagents={reloadSubagents} />)
    await waitForApiRef(apiRef)
    await tick()

    const res = await apiRef.current!.saveAgentFromDialog({
      scope: 'user',
      name: 'n2',
      description: 'd2',
      systemPrompt: 's2',
      tools: ['Read'],
      model: 'inherit',
      color: 'automatic',
      openInEditor: false,
    })

    expect(res).toEqual({ name: 'my-agent', filePath: '/tmp/my-agent.md' })
    await waitForText(app.lastFrame, 'reload failed: boom')
  })

  it('saveAgentFromDialog handles non-Error reload failure values', async () => {
    const apiRef = { current: null as HarnessApi | null }
    const reloadSubagents = vi.fn(async () => {
      throw 'string-failure'
    })
    const app = render(<Harness apiRef={apiRef} reloadSubagents={reloadSubagents} />)
    await waitForApiRef(apiRef)
    await tick()

    await apiRef.current!.saveAgentFromDialog({
      scope: 'project',
      name: 'n3',
      description: 'd3',
      systemPrompt: 's3',
      tools: ['Read'],
      model: 'inherit',
      color: 'automatic',
      openInEditor: false,
    })

    await waitForText(app.lastFrame, 'reload failed: string-failure')
  })

  it('unsubscribes overlay manager subscription on unmount', async () => {
    const { __test } = (await import('../../overlays/OverlayManager')) as any
    __test.reset()

    const apiRef = { current: null as HarnessApi | null }
    const app = render(<Harness apiRef={apiRef} />)
    await waitForApiRef(apiRef)
    await tick()

    const [unsubscribe] = __test.getUnsubscribes()
    expect(unsubscribe).toBeDefined()
    expect(unsubscribe).toHaveBeenCalledTimes(0)

    app.unmount()
    await tick()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })
})
