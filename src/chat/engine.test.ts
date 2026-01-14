import { describe, expect, it } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fsp from 'node:fs/promises'
import { createChatEngine } from './engine'
import type { PromptMessage } from '../prompts'
import type { ToolExecutor } from '../tools/executor'
import type { LlmStreamClient, LlmStreamOnceArgs, StreamEvent, StreamTurnResult } from '../streaming/types'
import { resolveTodosPath } from '../tools/runtime/todosFile'

describe('ChatEngine', () => {
  it('loops on stopReason=tool_use and appends tool_result messages', async () => {
    let callCount = 0

    const client: LlmStreamClient = {
      async streamOnce(_args: LlmStreamOnceArgs): Promise<StreamTurnResult> {
        callCount++
        if (callCount === 1) {
          return {
            assistantBlocks: [
              { type: 'text', text: 'hi' },
              { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/tmp/a' } },
            ],
            stopReason: 'tool_use',
            toolResults: [{ tool_use_id: 't1', content: 'ok' }],
          }
        }
        return {
          assistantBlocks: [{ type: 'text', text: 'done' }],
          stopReason: 'end_turn',
          toolResults: [],
        }
      },
    }

    const executor: ToolExecutor = async () => {
      throw new Error('executor should not be called by ChatEngine')
    }

    const events: StreamEvent[] = []
    const history: PromptMessage[] = []

    const engine = createChatEngine({ client, executor })
    const out = await engine.runTurn({
      history,
      user: { role: 'user', content: [{ type: 'text', text: 'go' }] },
      system: [],
      tools: [],
      onEvent: (ev) => events.push(ev),
      cwd: '/tmp',
    })

    expect(callCount).toBe(2)
    expect(out).toHaveLength(4)
    expect(out[0]!.role).toBe('user')
    expect(out[1]!.role).toBe('assistant')
    expect(out[2]!.role).toBe('user')
    expect((out[2]!.content[0] as any).type).toBe('tool_result')
    expect(events.some((e) => e.type === 'complete')).toBe(true)
  })

  it('appends todo_stale reminder to the last tool_result block after threshold', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-engine-'))
    const prevTodosPath = process.env.FORMAX_TODOS_PATH
    const prevConfigDir = process.env.FORMAX_CONFIG_DIR
    const prevTodosSessionId = process.env.FORMAX_TODOS_SESSION_ID

    try {
      if (prevTodosPath !== undefined) delete process.env.FORMAX_TODOS_PATH
      process.env.FORMAX_CONFIG_DIR = dir
      process.env.FORMAX_TODOS_SESSION_ID = 'test-session'

      const todosPath = resolveTodosPath(dir)
      await fsp.mkdir(path.dirname(todosPath), { recursive: true })
      await fsp.writeFile(
        todosPath,
        JSON.stringify(
          {
            todos: [
              { content: 'Task A', status: 'completed', activeForm: 'Doing A' },
              { content: 'Task B', status: 'in_progress', activeForm: 'Doing B' },
            ],
          },
          null,
          2,
        ),
        'utf8',
      )

      let callCount = 0
      let secondCallMessages: PromptMessage[] | null = null

      const client: LlmStreamClient = {
        async streamOnce(args: LlmStreamOnceArgs): Promise<StreamTurnResult> {
          callCount++

          if (callCount === 1) {
            return {
              assistantBlocks: [
                { type: 'tool_use', id: 'todo', name: 'TodoWrite', input: { todos: [] } },
                { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'npm run typecheck' } },
                { type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'npm run build' } },
                { type: 'tool_use', id: 't3', name: 'Bash', input: { command: 'node dist/cli/index.js --help' } },
              ],
              stopReason: 'tool_use',
              toolResults: [
                { tool_use_id: 'todo', content: 'ok' },
                { tool_use_id: 't1', content: 'typecheck ok' },
                { tool_use_id: 't2', content: 'build ok' },
                { tool_use_id: 't3', content: 'Usage: bilibili2str [options] <url>' },
              ],
            }
          }

          secondCallMessages = args.messages
          return { assistantBlocks: [{ type: 'text', text: 'done' }], stopReason: 'end_turn', toolResults: [] }
        },
      }

      const executor: ToolExecutor = async () => {
        throw new Error('executor should not be called by ChatEngine')
      }

      const engine = createChatEngine({ client, executor })
      await engine.runTurn({
        history: [],
        user: { role: 'user', content: [{ type: 'text', text: 'go' }] },
        system: [],
        tools: [],
        onEvent: (_ev: StreamEvent) => undefined,
        cwd: dir,
      })

      expect(callCount).toBe(2)
      expect(secondCallMessages).not.toBeNull()

      const last = secondCallMessages![secondCallMessages!.length - 1]!
      expect(last.role).toBe('user')
      const tr = Array.isArray(last.content) ? (last.content[0] as any) : null
      expect(tr?.type).toBe('tool_result')
      expect(String(tr?.content || '')).toContain('<system-reminder>')
      expect(String(tr?.content || '')).toContain("The TodoWrite tool hasn't been used recently")
      expect(String(tr?.content || '')).toContain('Here are the existing contents of your todo list:')
      expect(String(tr?.content || '')).toContain('[1. [completed] Task A')
    } finally {
      if (prevTodosPath === undefined) delete process.env.FORMAX_TODOS_PATH
      else process.env.FORMAX_TODOS_PATH = prevTodosPath
      if (prevConfigDir === undefined) delete process.env.FORMAX_CONFIG_DIR
      else process.env.FORMAX_CONFIG_DIR = prevConfigDir
      if (prevTodosSessionId === undefined) delete process.env.FORMAX_TODOS_SESSION_ID
      else process.env.FORMAX_TODOS_SESSION_ID = prevTodosSessionId
      await fsp.rm(dir, { recursive: true, force: true })
    }
  })
})
