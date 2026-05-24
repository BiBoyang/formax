import { describe, expect, it, vi } from 'vitest'
import type { ChatHistory } from '../../chat/engine'
import {
  detectNewTopicTitleCandidate,
  extractLastAssistantTextFromHistory,
  generateSessionTitle,
  normalizeSessionTitle,
} from './generate'

describe('sessionTitle generate helpers', () => {
  it('normalizes and truncates long titles', () => {
    const raw = `"${'x'.repeat(60)}"`
    const normalized = normalizeSessionTitle(raw)
    expect(normalized).toBe('x'.repeat(50))
  })

  it('normalizes CJK titles by display width instead of UTF-16 length only', () => {
    const normalized = normalizeSessionTitle('我现在这个项目有个桌面版本但是目前必须先配置baseurl和apikey')
    expect(normalized).toBe('我现在这个项目有个桌面版本但是目前必须先配置')
  })

  it('keeps complete ASCII words when mixed-language titles are display-width truncated', () => {
    const normalized = normalizeSessionTitle(`${'修'.repeat(21)} README 更多内容`)
    expect(normalized).toBe(`${'修'.repeat(21)} README`)
  })

  it('removes partial file tokens when mixed-language titles are display-width truncated', () => {
    const normalized = normalizeSessionTitle(`${'修'.repeat(21)} README.md 更多内容`)
    expect(normalized).toBe('修'.repeat(21))
  })

  it('uses streamed assistant deltas when generating a title', async () => {
    const runTurn = vi.fn(async (args: any) => {
      args.onEvent?.({ type: 'tool_update', text: 'ignored' })
      args.onEvent?.({ type: 'assistant_delta', text: '  Build a comprehensive integration testing strategy for session title generation  ' })
      return []
    })
    const title = await generateSessionTitle({
      engine: { runTurn },
      cwd: '/tmp',
      userText: '请给这个会话起标题',
    })
    expect(title).toBe('Build a comprehensive integration testing strategy')
  })

  it('returns null when generateSessionTitle user text is empty', async () => {
    const runTurn = vi.fn(async () => [])
    const title = await generateSessionTitle({
      engine: { runTurn },
      cwd: '/tmp',
      userText: '   ',
    })
    expect(title).toBeNull()
    expect(runTurn).not.toHaveBeenCalled()
  })

  it('falls back to the last assistant message when stream text is empty', async () => {
    const runTurn = vi.fn(async (): Promise<ChatHistory> => [
      { role: 'assistant', content: [{ type: 'text', text: '   Title from history   ' }] },
      { role: 'assistant', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'ignored' }] },
    ])
    const title = await generateSessionTitle({
      engine: { runTurn },
      cwd: '/tmp',
      userText: 'title please',
    })
    expect(title).toBe('Title from history')
  })

  it('includes provided assistantText in the title prompt context', async () => {
    const runTurn = vi.fn(async (args: any) => {
      const prompt = String(args.user?.content?.[0]?.text ?? '')
      expect(prompt).toContain('User: title please')
      expect(prompt).toContain('Assistant: previous answer')
      args.onEvent?.({ type: 'assistant_delta', text: 'short title' })
      return []
    })
    const title = await generateSessionTitle({
      engine: { runTurn },
      cwd: '/tmp',
      userText: 'title please',
      assistantText: 'previous answer',
    })
    expect(title).toBe('short title')
  })

  it('extracts last assistant text or null from history', () => {
    expect(extractLastAssistantTextFromHistory([] as any)).toBeNull()
    expect(
      extractLastAssistantTextFromHistory([
        { role: 'user', content: [{ type: 'text', text: 'hi' }] },
        { role: 'assistant', content: [{ type: 'text', text: '  hello  ' }] },
      ] as any),
    ).toBe('hello')
  })

  it('ignores non-text/non-array assistant content while extracting history text', () => {
    const out = extractLastAssistantTextFromHistory([
      { role: 'assistant', content: null },
      { role: 'assistant', content: [{ type: 'tool_result', text: 'x' }, 1, { type: 'text', text: 2 }] },
      { role: 'assistant', content: [{ type: 'text', text: '   ' }] },
    ] as any)
    expect(out).toBeNull()
  })

  it('detects topic decision from streamed json and rejects malformed payloads', async () => {
    const runTurnValid = vi.fn(async (args: any) => {
      args.onEvent?.({ type: 'assistant_delta', text: '"isNewTopic": true, "title": "Refactor session titles"}' })
      return []
    })
    const valid = await detectNewTopicTitleCandidate({
      engine: { runTurn: runTurnValid },
      cwd: '/tmp',
      userText: '我们换个话题聊重构',
    })
    expect(valid).toEqual({ isNewTopic: true, title: 'Refactor session titles' })

    const runTurnInvalid = vi.fn(async (): Promise<ChatHistory> => [
      { role: 'assistant', content: [{ type: 'text', text: '{invalid-json' }] },
    ])
    const invalid = await detectNewTopicTitleCandidate({
      engine: { runTurn: runTurnInvalid },
      cwd: '/tmp',
      userText: '继续',
    })
    expect(invalid).toBeNull()
  })

  it('returns null for empty topic text or invalid topic decision schema', async () => {
    const runTurnEmpty = vi.fn(async (): Promise<ChatHistory> => [
      { role: 'assistant', content: [{ type: 'text', text: '   ' }] },
    ])
    const empty = await detectNewTopicTitleCandidate({
      engine: { runTurn: runTurnEmpty },
      cwd: '/tmp',
      userText: 'topic?',
    })
    expect(empty).toBeNull()

    const runTurnBadSchema = vi.fn(async (args: any) => {
      args.onEvent?.({ type: 'thinking_delta', text: 'ignored' })
      return [
        { role: 'assistant', content: [{ type: 'text', text: '{"isNewTopic":"yes","title":"x"}' }] },
      ] satisfies ChatHistory
    })
    const badSchema = await detectNewTopicTitleCandidate({
      engine: { runTurn: runTurnBadSchema },
      cwd: '/tmp',
      userText: 'topic?',
    })
    expect(badSchema).toBeNull()
  })

  it('returns null for detectNewTopicTitleCandidate when user text is empty', async () => {
    const runTurn = vi.fn(async () => [])
    const out = await detectNewTopicTitleCandidate({
      engine: { runTurn },
      cwd: '/tmp',
      userText: ' ',
    })
    expect(out).toBeNull()
    expect(runTurn).not.toHaveBeenCalled()
  })

  it('treats undefined userText as empty for generate and detect helpers', async () => {
    const runTurn = vi.fn(async () => [])
    const generated = await generateSessionTitle({
      engine: { runTurn },
      cwd: '/tmp',
      userText: undefined as any,
    })
    const detected = await detectNewTopicTitleCandidate({
      engine: { runTurn },
      cwd: '/tmp',
      userText: undefined as any,
    })
    expect(generated).toBeNull()
    expect(detected).toBeNull()
    expect(runTurn).not.toHaveBeenCalled()
  })
})
