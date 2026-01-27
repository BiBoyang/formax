import React, { useMemo, useState } from 'react'
import { Box, Text } from 'ink'
import { render } from 'ink-testing-library'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChatEngine } from '../../../chat/engine.js'
import type { Msg } from '../../../components/tool/ToolMessage.js'
import type { OverlaySpec } from '../../commands/contracts.js'
import { useReplOverlays } from './overlays.js'

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

async function waitForText(
  lastFrame: () => string | undefined,
  text: string,
  timeoutMs = 10000,
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

type HarnessApi = {
  getOverlay: () => OverlaySpec | null
  getMessages: () => Msg[]
  openOverlay: (spec: OverlaySpec) => void
  closeOverlay: () => void
  closeAgentsDialog: (args: { createdAgents: string[] }) => void
  closePermissionsDialog: () => void
  closeHooksDialog: () => void
  saveAgentFromDialog: (args: any) => Promise<any>
}

function Harness(props: {
  apiRef: { current: HarnessApi | null }
  initialOverlay?: OverlaySpec | null
  reloadSubagents?: () => Promise<Array<{ name: string; description: string }>>
}) {
  const initialOverlay = props.initialOverlay ?? null
  const [messages, setMessagesState] = useState<Msg[]>([])
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
    saveAgentFromDialog: overlayApi.saveAgentFromDialog,
  }

  return (
    <Box flexDirection='column'>
      <Text>overlay={overlayApi.overlay ? overlayApi.overlay.kind : 'none'}</Text>
      <Text>allowed={allowedSubagents.map((a) => a.name).join(',')}</Text>
      <Text>last={messages.at(-1)?.content ?? ''}</Text>
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
    await tick()

    apiRef.current?.closeAgentsDialog({ createdAgents: [] })

    await waitForText(app.lastFrame, 'overlay=none')
    await waitForText(app.lastFrame, 'Agents dialog dismissed')
  })

  it('closeAgentsDialog appends a message (created agents)', async () => {
    const apiRef = { current: null as HarnessApi | null }
    const app = render(<Harness apiRef={apiRef} />)
    await tick()

    apiRef.current?.closeAgentsDialog({ createdAgents: ['a', 'b'] })

    await waitForText(app.lastFrame, 'Agent changes:')
    await waitForText(app.lastFrame, 'Created agent: a')
    await waitForText(app.lastFrame, 'Created agent: b')
  })

  it('closePermissionsDialog and closeHooksDialog append messages', async () => {
    const apiRef = { current: null as HarnessApi | null }
    const app = render(<Harness apiRef={apiRef} />)
    await tick()

    apiRef.current?.closePermissionsDialog()
    await waitForText(app.lastFrame, 'Permissions dialog dismissed')

    apiRef.current?.closeHooksDialog()
    await waitForText(app.lastFrame, 'Hooks dialog dismissed')
  })

  it('saveAgentFromDialog triggers reloadSubagents success and openInEditor message', async () => {
    const apiRef = { current: null as HarnessApi | null }
    const reloadSubagents = vi.fn(async () => [{ name: 'x', description: 'X' }])
    const app = render(<Harness apiRef={apiRef} reloadSubagents={reloadSubagents} />)
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

  it('saveAgentFromDialog handles reloadSubagents error and still returns', async () => {
    const apiRef = { current: null as HarnessApi | null }
    const reloadSubagents = vi.fn(async () => {
      throw new Error('boom')
    })
    const app = render(<Harness apiRef={apiRef} reloadSubagents={reloadSubagents} />)
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
})
