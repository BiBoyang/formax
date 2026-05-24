import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ChatHistory } from '../../chat/engine'
import { readSessionSummary } from '../repl/sessionSave/reader'
import { SessionWriter } from '../repl/sessionSave/writer'
import { detectNewTopicTitleCandidate, maybeAutoGenerateSessionTitle } from './index'

async function createSessionFixture() {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-session-title-cwd-'))
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-session-title-config-'))
  const env = { ...process.env, FORMAX_CONFIG_DIR: configDir }
  const created = await SessionWriter.createNew({ cwd, env, model: 'test-model' })
  await created.writer.shutdown()
  return { cwd, env, filePath: created.filePath, sessionId: created.meta.sessionId }
}

describe('maybeAutoGenerateSessionTitle', () => {
  it('generates and persists session_rename for unlabeled sessions', async () => {
    const fixture = await createSessionFixture()
    const attempted = new Set<string>()
    let runTurnCalls = 0

    const generated = await maybeAutoGenerateSessionTitle({
      filePath: fixture.filePath,
      cwd: fixture.cwd,
      attemptedSessionIds: attempted,
      userText: '我们来做 app-server GUI',
      assistantText: '先做一个可用 MVP，再分阶段补齐 approval 和历史恢复。',
      engine: {
        async runTurn(args) {
          runTurnCalls += 1
          return [
            ...args.history,
            args.user,
            { role: 'assistant', content: [{ type: 'text', text: 'App Server GUI MVP Plan' }] },
          ] as ChatHistory
        },
      },
    })

    expect(generated).toBe('App Server GUI MVP Plan')
    expect(runTurnCalls).toBe(1)

    const summary = await readSessionSummary(fixture.filePath)
    expect(summary.label).toBe('App Server GUI MVP Plan')

    const second = await maybeAutoGenerateSessionTitle({
      filePath: fixture.filePath,
      cwd: fixture.cwd,
      attemptedSessionIds: attempted,
      userText: 'another prompt',
      engine: {
        async runTurn(args) {
          runTurnCalls += 1
          return [...args.history, args.user] as ChatHistory
        },
      },
    })
    expect(second).toBeNull()
    expect(runTurnCalls).toBe(1)
  })

  it('skips topic detection and keeps existing labels', async () => {
    const fixture = await createSessionFixture()
    const writer = await SessionWriter.openExisting({ filePath: fixture.filePath })
    await writer.appendEvent('session_rename', { label: 'Manual Name' })
    await writer.shutdown()

    let runTurnCalls = 0
    const checkedTopicPromptKeys = new Set<string>()
    const generated = await maybeAutoGenerateSessionTitle({
      filePath: fixture.filePath,
      cwd: fixture.cwd,
      attemptedSessionIds: new Set<string>(),
      checkedTopicPromptKeys,
      userText: '聊点啥呢',
      engine: {
        async runTurn(args) {
          runTurnCalls += 1
          return [
            ...args.history,
            args.user,
            {
              role: 'assistant',
              content: [{ type: 'text', text: '{ "isNewTopic": false, "title": null }' }],
            },
          ] as ChatHistory
        },
      },
    })

    expect(generated).toBeNull()
    expect(runTurnCalls).toBe(0)
    const summary = await readSessionSummary(fixture.filePath)
    expect(summary.label).toBe('Manual Name')
    expect(checkedTopicPromptKeys.size).toBe(0)
  })

  it('does not overwrite existing labels when topic detector would return a new title', async () => {
    const fixture = await createSessionFixture()
    const writer = await SessionWriter.openExisting({ filePath: fixture.filePath })
    await writer.appendEvent('session_rename', { label: 'Old Label' })
    await writer.shutdown()

    const checkedTopicPromptKeys = new Set<string>()
    const generated = await maybeAutoGenerateSessionTitle({
      filePath: fixture.filePath,
      cwd: fixture.cwd,
      attemptedSessionIds: new Set<string>(),
      checkedTopicPromptKeys,
      userText: '我们切到 approval 交互设计',
      engine: {
        async runTurn(args) {
          return [
            ...args.history,
            args.user,
            {
              role: 'assistant',
              content: [{ type: 'text', text: '{ "isNewTopic": true, "title": "Approval 交互" }' }],
            },
          ] as ChatHistory
        },
      },
    })

    expect(generated).toBeNull()
    const summary = await readSessionSummary(fixture.filePath)
    expect(summary.label).toBe('Old Label')
    expect(checkedTopicPromptKeys.size).toBe(0)
  })

  it('parses topic decision JSON and normalizes title', async () => {
    const out = await detectNewTopicTitleCandidate({
      cwd: process.cwd(),
      userText: '聊点啥呢',
      engine: {
        async runTurn(args) {
          return [
            ...args.history,
            args.user,
            {
              role: 'assistant',
              content: [{ type: 'text', text: '{ "isNewTopic": true, "title": "  闲聊  " }' }],
            },
          ] as ChatHistory
        },
      },
    })

    expect(out).toEqual({ isNewTopic: true, title: '闲聊' })
  })

  it('passes model override to title generation turns', async () => {
    const fixture = await createSessionFixture()
    const attempted = new Set<string>()
    let seenModel: string | undefined

    const generated = await maybeAutoGenerateSessionTitle({
      filePath: fixture.filePath,
      cwd: fixture.cwd,
      attemptedSessionIds: attempted,
      userText: 'title please',
      model: 'glm-4.7',
      engine: {
        async runTurn(args) {
          seenModel = args.model
          return [
            ...args.history,
            args.user,
            { role: 'assistant', content: [{ type: 'text', text: 'Model Aware Title' }] },
          ] as ChatHistory
        },
      },
    })

    expect(generated).toBe('Model Aware Title')
    expect(seenModel).toBe('glm-4.7')
  })

  it('rolls back attempted session id when title generation returns null', async () => {
    const fixture = await createSessionFixture()
    const attempted = new Set<string>()

    const generated = await maybeAutoGenerateSessionTitle({
      filePath: fixture.filePath,
      cwd: fixture.cwd,
      attemptedSessionIds: attempted,
      userText: 'title please',
      engine: {
        async runTurn(args) {
          return [...args.history, args.user] as ChatHistory
        },
      },
    })

    expect(generated).toBeNull()
    expect(attempted.has(fixture.sessionId)).toBe(false)
  })

  it('records a failed attempt and rolls back attempted session id when title generation throws', async () => {
    const fixture = await createSessionFixture()
    const attempted = new Set<string>()

    const generated = await maybeAutoGenerateSessionTitle({
      filePath: fixture.filePath,
      cwd: fixture.cwd,
      attemptedSessionIds: attempted,
      userText: 'title please',
      engine: {
        async runTurn() {
          throw new Error('boom')
        },
      },
    })

    expect(generated).toBeNull()
    expect(attempted.has(fixture.sessionId)).toBe(false)
    const summary = await readSessionSummary(fixture.filePath)
    expect(summary.autoTitleAttemptCount).toBe(1)
    expect(summary.titleStatus).toBe('auto_retryable')
  })

  it('does not run topic detection for existing labels when the detector would throw', async () => {
    const fixture = await createSessionFixture()
    const writer = await SessionWriter.openExisting({ filePath: fixture.filePath })
    await writer.appendEvent('session_rename', { label: 'Manual Name' })
    await writer.shutdown()

    const checkedTopicPromptKeys = new Set<string>()
    const generated = await maybeAutoGenerateSessionTitle({
      filePath: fixture.filePath,
      cwd: fixture.cwd,
      attemptedSessionIds: new Set<string>(),
      checkedTopicPromptKeys,
      userText: 'new topic?',
      engine: {
        async runTurn() {
          throw new Error('topic fail')
        },
      },
    })

    expect(generated).toBeNull()
    expect(checkedTopicPromptKeys.size).toBe(0)
  })
})
