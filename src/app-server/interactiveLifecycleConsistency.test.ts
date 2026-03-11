import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ChatHistory } from '../chat/engine.js'
import { SessionWriter } from '../features/repl/sessionSave/index.js'
import { ENTER_PLAN_MODE_PROMPT, EXIT_PLAN_MODE_PROMPT } from '../features/tools/presentation/planModeQuestions.js'
import type { StreamEvent } from '../streaming/types.js'
import { createUserInputManager } from '../tools/runtime/userInputManager.js'
import { TurnRunner } from './turnRunner.js'

type Notification = { method: string; params?: any }
type InteractiveEvent = Extract<StreamEvent, { type: 'approval_request' | 'ask_user_question' }>

async function waitForNotification(
  notifications: Notification[],
  predicate: (n: Notification) => boolean,
  timeoutMs = 3000,
): Promise<Notification> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const found = notifications.find(predicate)
    if (found) return found
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('Timed out waiting for notification')
}

async function createThreadFixture() {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-interactive-flow-cwd-'))
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-interactive-flow-config-'))
  const env = { ...process.env, FORMAX_CONFIG_DIR: configDir }
  const created = await SessionWriter.createNew({ cwd, env })
  await created.writer.shutdown()
  return {
    cwd,
    env,
    threadId: created.meta.sessionId,
  }
}

function extractUserText(content: unknown): string {
  if (!Array.isArray(content)) return ''
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    if ((block as { type?: unknown }).type !== 'text') continue
    const value = (block as { text?: unknown }).text
    if (typeof value === 'string' && value.trim()) return value
  }
  return ''
}

type FlowCase = {
  name: string
  toolUseId: string
  event: InteractiveEvent
  submitAnswers: Record<string, string>
  assertRequestedInput: (input: any) => void
}

const ASK_QUESTION = {
  question: 'Pick one?',
  header: 'Choice',
  options: [{ label: 'A', description: 'Option A' }],
  multiSelect: false,
}

const FLOW_CASES: FlowCase[] = [
  {
    name: 'approval',
    toolUseId: 'approval-1',
    event: {
      type: 'approval_request',
      toolUseId: 'approval-1',
      toolName: 'Bash',
      action: { kind: 'bash.exec', command: 'echo hello' },
      effectiveDecision: 'prompt',
      suggestions: ['allow'],
      decisionReason: 'requires confirmation',
      blockedPath: '/tmp/outside',
      workspaceRequest: { dir: '/tmp/outside' },
    },
    submitAnswers: { decision: 'approve' },
    assertRequestedInput: (input) => {
      expect(input.kind).toBe('approval')
      expect(input.toolUseId).toBe('approval-1')
      expect(input.payload?.toolName).toBe('Bash')
      expect(input.payload?.action).toEqual({ kind: 'bash.exec', command: 'echo hello' })
      expect(input.payload?.effectiveDecision).toBe('prompt')
      expect(input.payload?.suggestions).toEqual(['allow'])
      expect(input.payload?.workspaceRequest).toEqual({ dir: '/tmp/outside' })
    },
  },
  {
    name: 'skill-preflight-approval',
    toolUseId: 'skill-approval-1',
    event: {
      type: 'approval_request',
      toolUseId: 'skill-approval-1',
      toolName: 'Skill',
      action: { kind: 'skill.use', skill: 'typescript' },
      effectiveDecision: 'prompt',
    },
    submitAnswers: { decision: 'approve' },
    assertRequestedInput: (input) => {
      expect(input.kind).toBe('approval')
      expect(input.toolUseId).toBe('skill-approval-1')
      expect(input.payload?.toolName).toBe('Skill')
      expect(input.payload?.action).toEqual({ kind: 'skill.use', skill: 'typescript' })
      expect(input.payload?.effectiveDecision).toBe('prompt')
    },
  },
  {
    name: 'ask-user-question',
    toolUseId: 'ask-1',
    event: {
      type: 'ask_user_question',
      toolUseId: 'ask-1',
      questions: [ASK_QUESTION],
    },
    submitAnswers: { Choice: 'A' },
    assertRequestedInput: (input) => {
      expect(input.kind).toBe('ask_user_question')
      expect(input.toolUseId).toBe('ask-1')
      expect(input.payload?.questions).toEqual([ASK_QUESTION])
    },
  },
  {
    name: 'enter-plan-mode',
    toolUseId: 'enter-plan-1',
    event: {
      type: 'ask_user_question',
      toolUseId: 'enter-plan-1',
      questions: [ENTER_PLAN_MODE_PROMPT],
    },
    submitAnswers: { choice: 'enter' },
    assertRequestedInput: (input) => {
      expect(input.kind).toBe('ask_user_question')
      expect(input.toolUseId).toBe('enter-plan-1')
      expect(input.payload?.questions?.[0]?.question).toBe(ENTER_PLAN_MODE_PROMPT.question)
      expect(input.payload?.questions?.[0]?.header).toBe(ENTER_PLAN_MODE_PROMPT.header)
    },
  },
  {
    name: 'exit-plan-mode',
    toolUseId: 'exit-plan-1',
    event: {
      type: 'ask_user_question',
      toolUseId: 'exit-plan-1',
      questions: [EXIT_PLAN_MODE_PROMPT],
    },
    submitAnswers: { choice: 'manual' },
    assertRequestedInput: (input) => {
      expect(input.kind).toBe('ask_user_question')
      expect(input.toolUseId).toBe('exit-plan-1')
      expect(input.payload?.questions?.[0]?.question).toBe(EXIT_PLAN_MODE_PROMPT.question)
      expect(input.payload?.questions?.[0]?.header).toBe(EXIT_PLAN_MODE_PROMPT.header)
    },
  },
]

describe('interactive lifecycle consistency', () => {
  it.each(FLOW_CASES)('preserves inputRequested -> submitted -> inputResolved ordering for $name', async (flowCase) => {
    const fixture = await createThreadFixture()
    const notifications: Notification[] = []
    const userInput = createUserInputManager()

    const runner = new TurnRunner({
      engine: {
        async runTurn(args) {
          const userText = extractUserText(args.user.content)
          // Auto-title invokes a follow-up turn using a title-generation prompt.
          if (userText.includes('Please write a 5-10 word title')) {
            return [
              ...args.history,
              args.user,
              { role: 'assistant', content: [{ type: 'text', text: 'Lifecycle Title' }] },
            ] as ChatHistory
          }

          args.onEvent(flowCase.event)
          const questions = flowCase.event.type === 'ask_user_question' ? flowCase.event.questions : []
          await userInput.requestAnswers({
            toolUseId: flowCase.toolUseId,
            questions,
            signal: args.signal,
          })
          args.onEvent({ type: 'assistant_delta', text: `${flowCase.name} done` })
          args.onEvent({ type: 'complete' })
          return [
            ...args.history,
            args.user,
            { role: 'assistant', content: [{ type: 'text', text: `${flowCase.name} done` }] },
          ] as ChatHistory
        },
      },
      tools: [],
      allowedSubagents: [],
      model: 'test-model',
      cwd: fixture.cwd,
      env: fixture.env,
      userInputManager: userInput,
      emitNotification(method, params) {
        notifications.push({ method, params })
      },
    })

    const started = await runner.startTurn({
      threadId: fixture.threadId,
      input: { text: `run ${flowCase.name}` },
    })

    const requested = await waitForNotification(
      notifications,
      (n) => n.method === 'turn/inputRequested' && n.params?.input?.toolUseId === flowCase.toolUseId,
    )
    const inputPayload = requested.params?.input
    flowCase.assertRequestedInput(inputPayload)
    expect(inputPayload?.status).toBe('pending')

    const submitResult = await runner.submitInput({
      threadId: fixture.threadId,
      turnId: started.turn.id,
      inputId: inputPayload.inputId,
      answers: flowCase.submitAnswers,
      submissionId: `submit-${flowCase.name}`,
    })
    expect(submitResult).toEqual({ accepted: true, status: 'accepted' })

    const resolved = await waitForNotification(
      notifications,
      (n) =>
        n.method === 'turn/inputResolved' &&
        n.params?.input?.toolUseId === flowCase.toolUseId &&
        n.params?.input?.status === 'submitted',
    )
    const completed = await waitForNotification(
      notifications,
      (n) => n.method === 'turn/completed' && n.params?.turn?.id === started.turn.id,
    )

    const requestedIndex = notifications.findIndex((n) => n === requested)
    const resolvedIndex = notifications.findIndex((n) => n === resolved)
    const completedIndex = notifications.findIndex((n) => n === completed)
    expect(requestedIndex).toBeGreaterThanOrEqual(0)
    expect(resolvedIndex).toBeGreaterThan(requestedIndex)
    expect(completedIndex).toBeGreaterThan(resolvedIndex)
  })
})
