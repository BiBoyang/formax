import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ChatHistory } from '../chat/engine.js'
import { findSessionFileBySessionId, readSessionFile, readSessionSummary, SessionWriter } from '../features/repl/sessionSave/index.js'
import { buildInitPrompt } from '../prompts/init.js'
import { createUserInputManager } from '../tools/runtime/userInputManager.js'
import { TurnRunner } from './turnRunner.js'

type Notification = { method: string; params?: any }

async function waitForNotification(
  notifications: Notification[],
  predicate: (n: Notification) => boolean,
  timeoutMs = 2000,
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
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-turn-runner-cwd-'))
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-turn-runner-config-'))
  const env = { ...process.env, FORMAX_CONFIG_DIR: configDir }
  const created = await SessionWriter.createNew({ cwd, env })
  await created.writer.shutdown()
  return {
    cwd,
    env,
    threadId: created.meta.sessionId,
  }
}

describe('TurnRunner', () => {
  it('runs a turn, emits events, and persists history', async () => {
    const fixture = await createThreadFixture()
    const notifications: Notification[] = []

    const runner = new TurnRunner({
      engine: {
        async runTurn(args) {
          args.onEvent({
            type: 'ask_user_question',
            toolUseId: 'ask-1',
            questions: [
              {
                question: 'Pick one?',
                header: 'Choice',
                options: [{ label: 'A', description: 'Option A' }],
                multiSelect: false,
              },
            ],
          })
          args.onEvent({ type: 'assistant_delta', text: 'hello' })
          args.onEvent({ type: 'complete' })
          return [
            ...args.history,
            args.user,
            { role: 'assistant', content: [{ type: 'text', text: 'hello' }] },
          ] as ChatHistory
        },
      },
      tools: [],
      allowedSubagents: [],
      model: 'test-model',
      promptProfile: 'lite',
      cwd: fixture.cwd,
      env: fixture.env,
      emitNotification(method, params) {
        notifications.push({ method, params })
      },
    })

    const started = await runner.startTurn({
      threadId: fixture.threadId,
      input: { text: 'say hello' },
    })
    expect(started.turn.status).toBe('running')

    await waitForNotification(notifications, (n) => n.method === 'turn/completed')
    expect(
      notifications.some(
        (n) => n.method === 'turn/inputRequested' && n.params?.input?.kind === 'ask_user_question',
      ),
    ).toBe(true)
    expect(
      notifications.some(
        (n) => n.method === 'turn/inputResolved' && n.params?.input?.status === 'failed',
      ),
    ).toBe(true)

    const filePath = await findSessionFileBySessionId({
      cwd: fixture.cwd,
      env: fixture.env,
      sessionId: fixture.threadId,
    })
    expect(filePath).toBeTruthy()
    const replay = await readSessionFile(filePath!)
    expect(replay.history.at(-1)?.role).toBe('assistant')
    expect(replay.messages.some((m) => m.role === 'user' && m.content === 'say hello')).toBe(true)
    expect(replay.messages.some((m) => m.role === 'assistant' && m.content.includes('hello'))).toBe(true)

    expect(notifications.some((n) => n.method === 'turn/started')).toBe(true)
    expect(notifications.some((n) => n.method === 'turn/event')).toBe(true)
    expect(notifications.every((n) => typeof n.params?.seq === 'number')).toBe(true)
    expect(notifications.every((n) => typeof n.params?.traceId === 'string')).toBe(true)
  })

  it('supports interrupt and clears in-flight lock for next turn', async () => {
    const fixture = await createThreadFixture()
    const notifications: Notification[] = []

    const runner = new TurnRunner({
      engine: {
        async runTurn(args) {
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(resolve, 50)
            args.signal?.addEventListener(
              'abort',
              () => {
                clearTimeout(timer)
                reject(new Error('Request aborted'))
              },
              { once: true },
            )
          })
          return [...args.history, args.user] as ChatHistory
        },
      },
      tools: [],
      allowedSubagents: [],
      model: 'test-model',
      promptProfile: 'lite',
      cwd: fixture.cwd,
      env: fixture.env,
      emitNotification(method, params) {
        notifications.push({ method, params })
      },
    })

    const turn1 = await runner.startTurn({ threadId: fixture.threadId, input: { text: 'one' } })
    await runner.interruptTurn({ threadId: fixture.threadId, turnId: turn1.turn.id })
    const failed = await waitForNotification(notifications, (n) => n.method === 'turn/failed')
    expect(failed.params?.turn?.status).toBe('interrupted')

    const turn2 = await runner.startTurn({ threadId: fixture.threadId, input: { text: 'two' } })
    expect(turn2.turn.status).toBe('running')
    await waitForNotification(
      notifications,
      (n) => n.method === 'turn/completed' && n.params?.turn?.id === turn2.turn.id,
    )
  })

  it('submits answers through userInputManager and emits inputResolved', async () => {
    const fixture = await createThreadFixture()
    const notifications: Notification[] = []
    const userInput = createUserInputManager()

    const runner = new TurnRunner({
      engine: {
        async runTurn(args) {
          const userText = Array.isArray(args.user.content)
            ? String((args.user.content.find((b) => (b as any)?.type === 'text') as any)?.text ?? '')
            : ''
          if (args.tools.length === 0 && userText.includes('Please write a 5-10 word title')) {
            return [
              ...args.history,
              args.user,
              { role: 'assistant', content: [{ type: 'text', text: 'Turn Question Title' }] },
            ] as ChatHistory
          }
          const questions = [
            {
              question: 'Pick one?',
              header: 'Choice',
              options: [{ label: 'A', description: 'Option A' }],
              multiSelect: false,
            },
          ]
          args.onEvent({ type: 'ask_user_question', toolUseId: 'ask-1', questions })
          const answers = await userInput.requestAnswers({ toolUseId: 'ask-1', questions, signal: args.signal })
          args.onEvent({ type: 'assistant_delta', text: String(answers.Choice ?? '') })
          args.onEvent({ type: 'complete' })
          return [
            ...args.history,
            args.user,
            { role: 'assistant', content: [{ type: 'text', text: String(answers.Choice ?? '') }] },
          ] as ChatHistory
        },
      },
      tools: [],
      allowedSubagents: [],
      model: 'test-model',
      promptProfile: 'lite',
      cwd: fixture.cwd,
      env: fixture.env,
      userInputManager: userInput,
      emitNotification(method, params) {
        notifications.push({ method, params })
      },
    })

    const started = await runner.startTurn({ threadId: fixture.threadId, input: { text: 'question' } })
    const requested = await waitForNotification(
      notifications,
      (n) => n.method === 'turn/inputRequested' && n.params?.input?.kind === 'ask_user_question',
    )

    const out = await runner.submitInput({
      threadId: fixture.threadId,
      turnId: started.turn.id,
      inputId: 'ask-1',
      answers: { Choice: 'A' },
      submissionId: 'sub-1',
    })
    expect(out).toEqual({ accepted: true, status: 'accepted' })

    const resolved = await waitForNotification(
      notifications,
      (n) => n.method === 'turn/inputResolved' && n.params?.input?.status === 'submitted',
    )
    expect(resolved.params?.input?.inputId).toBe(requested.params.input.inputId)

    await waitForNotification(notifications, (n) => n.method === 'turn/completed')
  })

  it('expires pending input by TTL and emits expired resolution', async () => {
    const fixture = await createThreadFixture()
    const notifications: Notification[] = []
    const userInput = createUserInputManager()

    const runner = new TurnRunner({
      engine: {
        async runTurn(args) {
          const questions = [
            {
              question: 'Pick one?',
              header: 'Choice',
              options: [{ label: 'A', description: 'Option A' }],
              multiSelect: false,
            },
          ]
          args.onEvent({ type: 'ask_user_question', toolUseId: 'ask-expire-1', questions })
          await userInput.requestAnswers({ toolUseId: 'ask-expire-1', questions, signal: args.signal })
          return [...args.history, args.user] as ChatHistory
        },
      },
      tools: [],
      allowedSubagents: [],
      model: 'test-model',
      promptProfile: 'lite',
      cwd: fixture.cwd,
      env: fixture.env,
      userInputManager: userInput,
      defaultInputTtlMs: 20,
      emitNotification(method, params) {
        notifications.push({ method, params })
      },
    })

    const started = await runner.startTurn({ threadId: fixture.threadId, input: { text: 'expire me' } })

    const requested = await waitForNotification(
      notifications,
      (n) => n.method === 'turn/inputRequested' && n.params?.input?.toolUseId === 'ask-expire-1',
    )
    const expired = await waitForNotification(
      notifications,
      (n) => n.method === 'turn/inputResolved' && n.params?.input?.status === 'expired',
      3000,
    )
    const failed = await waitForNotification(notifications, (n) => n.method === 'turn/failed')

    expect(expired.params?.input?.inputId).toBe(requested.params?.input?.inputId)
    expect(String(failed.params?.error ?? '')).toContain('Input expired')

    const requestedAt = notifications.findIndex((n) => n === requested)
    const expiredAt = notifications.findIndex((n) => n === expired)
    const failedAt = notifications.findIndex((n) => n === failed)
    expect(requestedAt).toBeGreaterThanOrEqual(0)
    expect(expiredAt).toBeGreaterThan(requestedAt)
    expect(failedAt).toBeGreaterThan(expiredAt)

    const submit = await runner.submitInput({
      threadId: fixture.threadId,
      turnId: started.turn.id,
      inputId: requested.params?.input?.inputId,
      answers: { Choice: 'A' },
      submissionId: 'late-submit',
    })
    expect(submit).toEqual({ accepted: false, status: 'not_pending' })
  })

  it('emits failed when engine runTurn throws', async () => {
    const fixture = await createThreadFixture()
    const notifications: Notification[] = []

    const runner = new TurnRunner({
      engine: {
        async runTurn() {
          throw new Error('boom')
        },
      },
      tools: [],
      allowedSubagents: [],
      model: 'test-model',
      promptProfile: 'lite',
      cwd: fixture.cwd,
      env: fixture.env,
      emitNotification(method, params) {
        notifications.push({ method, params })
      },
    })

    const started = await runner.startTurn({ threadId: fixture.threadId, input: { text: 'explode' } })
    expect(started.turn.status).toBe('running')

    const failed = await waitForNotification(notifications, (n) => n.method === 'turn/failed')
    expect(failed.params?.turn?.status).toBe('failed')
    expect(String(failed.params?.error ?? '')).toContain('boom')
  })

  it('keeps approval toolName in input payload', async () => {
    const fixture = await createThreadFixture()
    const notifications: Notification[] = []

    const runner = new TurnRunner({
      engine: {
        async runTurn(args) {
          args.onEvent({
            type: 'approval_request',
            toolUseId: 'approval-1',
            toolName: 'Bash',
            action: { kind: 'bash.exec' },
            effectiveDecision: { decision: 'ask' },
          })
          args.onEvent({ type: 'complete' })
          return [...args.history, args.user] as ChatHistory
        },
      },
      tools: [],
      allowedSubagents: [],
      model: 'test-model',
      promptProfile: 'lite',
      cwd: fixture.cwd,
      env: fixture.env,
      emitNotification(method, params) {
        notifications.push({ method, params })
      },
    })

    await runner.startTurn({ threadId: fixture.threadId, input: { text: 'check' } })
    const approvalRequested = await waitForNotification(
      notifications,
      (n) => n.method === 'turn/inputRequested' && n.params?.input?.kind === 'approval',
    )
    expect(approvalRequested.params?.input?.payload?.toolName).toBe('Bash')
  })

  it('auto-generates session title once after completed turn', async () => {
    const fixture = await createThreadFixture()
    const notifications: Notification[] = []

    const runner = new TurnRunner({
      engine: {
        async runTurn(args) {
          const userText = Array.isArray(args.user.content)
            ? String((args.user.content.find((b) => (b as any)?.type === 'text') as any)?.text ?? '')
            : ''
          if (args.tools.length === 0 && userText.includes('Please write a 5-10 word title')) {
            return [
              ...args.history,
              args.user,
              { role: 'assistant', content: [{ type: 'text', text: 'Auto Title Test' }] },
            ] as ChatHistory
          }
          args.onEvent({ type: 'assistant_delta', text: 'main assistant reply' })
          args.onEvent({ type: 'complete' })
          return [
            ...args.history,
            args.user,
            { role: 'assistant', content: [{ type: 'text', text: 'main assistant reply' }] },
          ] as ChatHistory
        },
      },
      tools: [],
      allowedSubagents: [],
      model: 'test-model',
      promptProfile: 'lite',
      cwd: fixture.cwd,
      env: fixture.env,
      emitNotification(method, params) {
        notifications.push({ method, params })
      },
    })

    await runner.startTurn({
      threadId: fixture.threadId,
      input: { text: 'please start and make a title' },
    })
    await waitForNotification(notifications, (n) => n.method === 'turn/completed')

    const filePath = await findSessionFileBySessionId({
      cwd: fixture.cwd,
      env: fixture.env,
      sessionId: fixture.threadId,
    })
    expect(filePath).toBeTruthy()
    const summary = await readSessionSummary(filePath!)
    expect(summary.label).toBe('Auto Title Test')
  })

  it('updates existing session title when topic changes', async () => {
    const fixture = await createThreadFixture()
    const seedWriter = await SessionWriter.openExisting({
      filePath: (
        await findSessionFileBySessionId({
          cwd: fixture.cwd,
          env: fixture.env,
          sessionId: fixture.threadId,
        })
      )!,
    })
    await seedWriter.appendEvent('session_rename', { label: 'Old Topic' })
    await seedWriter.shutdown()

    const notifications: Notification[] = []
    const runner = new TurnRunner({
      engine: {
        async runTurn(args) {
          const userText = Array.isArray(args.user.content)
            ? String((args.user.content.find((b) => (b as any)?.type === 'text') as any)?.text ?? '')
            : ''
          const systemText = Array.isArray(args.system)
            ? args.system
                .map((block) => ((block as any)?.type === 'text' ? String((block as any).text ?? '') : ''))
                .join('\n')
            : ''
          if (args.tools.length === 0 && systemText.includes('Analyze if this message indicates a new conversation topic')) {
            return [
              ...args.history,
              args.user,
              { role: 'assistant', content: [{ type: 'text', text: '{ "isNewTopic": true, "title": "New Topic" }' }] },
            ] as ChatHistory
          }
          args.onEvent({ type: 'assistant_delta', text: 'turn complete' })
          args.onEvent({ type: 'complete' })
          return [
            ...args.history,
            args.user,
            { role: 'assistant', content: [{ type: 'text', text: 'turn complete' }] },
          ] as ChatHistory
        },
      },
      tools: [],
      allowedSubagents: [],
      model: 'test-model',
      promptProfile: 'lite',
      cwd: fixture.cwd,
      env: fixture.env,
      emitNotification(method, params) {
        notifications.push({ method, params })
      },
    })

    await runner.startTurn({
      threadId: fixture.threadId,
      input: { text: '我们现在改聊 diff 面板' },
    })
    await waitForNotification(notifications, (n) => n.method === 'turn/completed')

    const filePath = await findSessionFileBySessionId({
      cwd: fixture.cwd,
      env: fixture.env,
      sessionId: fixture.threadId,
    })
    expect(filePath).toBeTruthy()
    const summary = await readSessionSummary(filePath!)
    expect(summary.label).toBe('New Topic')
  })

  it('maps /init to init prompt for model while keeping user transcript text', async () => {
    const fixture = await createThreadFixture()
    const notifications: Notification[] = []
    let capturedUserText = ''

    const runner = new TurnRunner({
      engine: {
        async runTurn(args) {
          const userText = Array.isArray(args.user.content)
            ? String((args.user.content.find((b) => (b as any)?.type === 'text') as any)?.text ?? '')
            : ''
          if (userText.includes('Please write a 5-10 word title')) {
            return [
              ...args.history,
              args.user,
              { role: 'assistant', content: [{ type: 'text', text: 'Init Title' }] },
            ] as ChatHistory
          }
          capturedUserText = userText
          args.onEvent({ type: 'assistant_delta', text: 'ok' })
          args.onEvent({ type: 'complete' })
          return [
            ...args.history,
            args.user,
            { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
          ] as ChatHistory
        },
      },
      tools: [],
      allowedSubagents: [],
      model: 'test-model',
      promptProfile: 'lite',
      cwd: fixture.cwd,
      env: fixture.env,
      emitNotification(method, params) {
        notifications.push({ method, params })
      },
    })

    await runner.startTurn({
      threadId: fixture.threadId,
      input: { text: '/init' },
    })
    await waitForNotification(notifications, (n) => n.method === 'turn/completed')

    expect(capturedUserText).toBe(buildInitPrompt())

    const filePath = await findSessionFileBySessionId({
      cwd: fixture.cwd,
      env: fixture.env,
      sessionId: fixture.threadId,
    })
    expect(filePath).toBeTruthy()
    const replay = await readSessionFile(filePath!)
    expect(replay.messages.some((m) => m.role === 'user' && m.content === '/init')).toBe(true)
  })

  it('executes /compact semantics and persists compacted history', async () => {
    const fixture = await createThreadFixture()
    const notifications: Notification[] = []
    const toolStub = { name: 'DummyTool' } as any
    let compactToolsLength = -1
    let compactReplMode: string | undefined
    let compactPromptText = ''

    const runner = new TurnRunner({
      engine: {
        async runTurn(args) {
          if (args.tools.length === 0) {
            compactToolsLength = args.tools.length
            compactReplMode = args.exec?.replMode as string | undefined
            compactPromptText = Array.isArray(args.user.content)
              ? args.user.content
                  .map((block) => {
                    if (!block || typeof block !== 'object') return ''
                    if ((block as { type?: unknown }).type !== 'text') return ''
                    const text = (block as { text?: unknown }).text
                    return typeof text === 'string' ? text : ''
                  })
                  .filter(Boolean)
                  .join('\n\n')
              : ''
            return [
              ...args.history,
              args.user,
              { role: 'assistant', content: [{ type: 'text', text: 'Compaction summary from model' }] },
            ] as ChatHistory
          }
          args.onEvent({ type: 'assistant_delta', text: 'normal reply' })
          args.onEvent({ type: 'complete' })
          return [
            ...args.history,
            args.user,
            { role: 'assistant', content: [{ type: 'text', text: 'normal reply' }] },
          ] as ChatHistory
        },
      },
      tools: [toolStub],
      allowedSubagents: [],
      model: 'test-model',
      promptProfile: 'lite',
      cwd: fixture.cwd,
      env: fixture.env,
      emitNotification(method, params) {
        notifications.push({ method, params })
      },
    })

    await runner.startTurn({
      threadId: fixture.threadId,
      input: { text: 'hello before compact' },
    })
    await waitForNotification(notifications, (n) => n.method === 'turn/completed')

    const compactStarted = await runner.startTurn({
      threadId: fixture.threadId,
      input: { text: '/compact keep the intent only' },
      mode: 'plan',
    })
    await waitForNotification(
      notifications,
      (n) => n.method === 'turn/completed' && n.params?.turn?.id === compactStarted.turn.id,
    )

    expect(
      notifications.some(
        (n) =>
          n.method === 'turn/event' &&
          n.params?.turnId === compactStarted.turn.id &&
          n.params?.event?.type === 'assistant_delta' &&
          String(n.params?.event?.text ?? '').includes('Conversation compacted'),
      ),
    ).toBe(true)
    expect(compactToolsLength).toBe(0)
    expect(compactReplMode).toBe('plan')
    expect(compactPromptText).toContain('Additional user instructions:')
    expect(compactPromptText).toContain('keep the intent only')

    const filePath = await findSessionFileBySessionId({
      cwd: fixture.cwd,
      env: fixture.env,
      sessionId: fixture.threadId,
    })
    expect(filePath).toBeTruthy()
    const replay = await readSessionFile(filePath!)

    expect(replay.history).toHaveLength(1)
    expect(replay.history[0]?.role).toBe('user')
    const summaryText = Array.isArray(replay.history[0]?.content)
      ? String((replay.history[0]!.content[0] as { text?: string } | undefined)?.text ?? '')
      : ''
    expect(summaryText).toContain('This session is being continued from a previous conversation')

    expect(replay.messages.some((message) => message.role === 'user' && message.content === '/compact keep the intent only')).toBe(true)
    expect(
      replay.messages.some(
        (message) =>
          message.role === 'assistant' &&
          String(message.content).includes('Conversation compacted. Summary kept for future turns.'),
      ),
    ).toBe(true)
  })

  it('passes turn mode to engine exec context and keeps interactive on', async () => {
    const fixture = await createThreadFixture()
    const notifications: Notification[] = []
    let capturedReplMode: string | undefined
    let capturedInteractive: boolean | undefined
    let capturedFirstUserTextBlock: string | undefined

    const runner = new TurnRunner({
      engine: {
        async runTurn(args) {
          const userText = Array.isArray(args.user.content)
            ? String((args.user.content.find((b) => (b as any)?.type === 'text') as any)?.text ?? '')
            : ''
          if (userText.includes('Please write a 5-10 word title')) {
            return [
              ...args.history,
              args.user,
              { role: 'assistant', content: [{ type: 'text', text: 'Mode Title' }] },
            ] as ChatHistory
          }
          capturedFirstUserTextBlock = userText
          capturedReplMode = args.exec?.replMode as string | undefined
          capturedInteractive = args.exec?.interactive
          args.onEvent({ type: 'assistant_delta', text: 'ok' })
          args.onEvent({ type: 'complete' })
          return [
            ...args.history,
            args.user,
            { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
          ] as ChatHistory
        },
      },
      tools: [],
      allowedSubagents: [],
      model: 'test-model',
      promptProfile: 'lite',
      cwd: fixture.cwd,
      env: fixture.env,
      emitNotification(method, params) {
        notifications.push({ method, params })
      },
    })

    await runner.startTurn({
      threadId: fixture.threadId,
      input: { text: 'mode test' },
      mode: 'plan',
    })
    await waitForNotification(notifications, (n) => n.method === 'turn/completed')

    expect(capturedFirstUserTextBlock).toContain('Plan mode is active')
    expect(capturedReplMode).toBe('plan')
    expect(capturedInteractive).toBe(true)

    const filePath = await findSessionFileBySessionId({
      cwd: fixture.cwd,
      env: fixture.env,
      sessionId: fixture.threadId,
    })
    expect(filePath).toBeTruthy()
    const replay = await readSessionFile(filePath!)
    const userMessages = replay.history.filter((message) => message.role === 'user')
    const latestUser = userMessages[userMessages.length - 1]
    const latestUserText = Array.isArray(latestUser?.content)
      ? String((latestUser.content[0] as { text?: string } | undefined)?.text ?? '')
      : ''
    expect(latestUserText).toBe('mode test')
  })

  it('injects exit-plan reminder when explicitly requested', async () => {
    const fixture = await createThreadFixture()
    const notifications: Notification[] = []
    let capturedFirstUserTextBlock = ''

    const runner = new TurnRunner({
      engine: {
        async runTurn(args) {
          const userText = Array.isArray(args.user.content)
            ? String((args.user.content.find((b) => (b as any)?.type === 'text') as any)?.text ?? '')
            : ''
          if (userText.includes('Please write a 5-10 word title')) {
            return [
              ...args.history,
              args.user,
              { role: 'assistant', content: [{ type: 'text', text: 'Exit Reminder Title' }] },
            ] as ChatHistory
          }
          capturedFirstUserTextBlock = userText
          args.onEvent({ type: 'assistant_delta', text: 'ok' })
          args.onEvent({ type: 'complete' })
          return [
            ...args.history,
            args.user,
            { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
          ] as ChatHistory
        },
      },
      tools: [],
      allowedSubagents: [],
      model: 'test-model',
      promptProfile: 'lite',
      cwd: fixture.cwd,
      env: fixture.env,
      emitNotification(method, params) {
        notifications.push({ method, params })
      },
    })

    await runner.startTurn({
      threadId: fixture.threadId,
      input: { text: 'continue implementation' },
      mode: 'normal',
      includeExitPlanReminder: true,
    })
    await waitForNotification(notifications, (n) => n.method === 'turn/completed')

    expect(capturedFirstUserTextBlock).toContain('You have exited plan mode')
    expect(capturedFirstUserTextBlock).not.toContain('Plan mode is active')

    const filePath = await findSessionFileBySessionId({
      cwd: fixture.cwd,
      env: fixture.env,
      sessionId: fixture.threadId,
    })
    expect(filePath).toBeTruthy()
    const replay = await readSessionFile(filePath!)
    const userMessages = replay.history.filter((message) => message.role === 'user')
    const latestUser = userMessages[userMessages.length - 1]
    const latestUserText = Array.isArray(latestUser?.content)
      ? String((latestUser.content[0] as { text?: string } | undefined)?.text ?? '')
      : ''
    expect(latestUserText).toBe('continue implementation')
  })

  it('emits mode transition notifications when tools change repl mode', async () => {
    const fixture = await createThreadFixture()
    const notifications: Notification[] = []
    const observedModes: string[] = []

    const runner = new TurnRunner({
      engine: {
        async runTurn(args) {
          const userText = Array.isArray(args.user.content)
            ? String((args.user.content.find((b) => (b as any)?.type === 'text') as any)?.text ?? '')
            : ''
          if (userText.includes('Please write a 5-10 word title')) {
            return [
              ...args.history,
              args.user,
              { role: 'assistant', content: [{ type: 'text', text: 'Mode Transition Title' }] },
            ] as ChatHistory
          }
          observedModes.push(String(args.exec?.getReplMode?.() ?? args.exec?.replMode ?? ''))
          args.exec?.setReplMode?.('plan')
          observedModes.push(String(args.exec?.getReplMode?.() ?? args.exec?.replMode ?? ''))
          args.exec?.setReplMode?.('plan')
          args.exec?.setReplMode?.('acceptEdits')
          observedModes.push(String(args.exec?.getReplMode?.() ?? args.exec?.replMode ?? ''))
          args.onEvent({ type: 'assistant_delta', text: 'done' })
          args.onEvent({ type: 'complete' })
          return [
            ...args.history,
            args.user,
            { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
          ] as ChatHistory
        },
      },
      tools: [],
      allowedSubagents: [],
      model: 'test-model',
      promptProfile: 'lite',
      cwd: fixture.cwd,
      env: fixture.env,
      emitNotification(method, params) {
        notifications.push({ method, params })
      },
    })

    await runner.startTurn({
      threadId: fixture.threadId,
      input: { text: 'mode transition test' },
      mode: 'normal',
    })
    await waitForNotification(notifications, (n) => n.method === 'turn/completed')

    expect(observedModes).toEqual(['normal', 'plan', 'acceptEdits'])
    const modeNotifications = notifications.filter((entry) => entry.method === 'turn/modeChanged')
    expect(modeNotifications).toHaveLength(2)
    expect(modeNotifications.map((entry) => (entry.params as any)?.previousMode)).toEqual(['normal', 'plan'])
    expect(modeNotifications.map((entry) => (entry.params as any)?.mode)).toEqual(['plan', 'acceptEdits'])
  })
})
