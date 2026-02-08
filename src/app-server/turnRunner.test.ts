import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ChatHistory } from '../chat/engine.js'
import { findSessionFileBySessionId, readSessionFile, SessionWriter } from '../features/repl/sessionSave/index.js'
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
        (n) => n.method === 'turn/inputRequested' && n.params?.input?.type === 'ask_user_question',
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
})
