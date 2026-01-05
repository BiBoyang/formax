import React, { useState, useCallback } from 'react'
import { Box, Text, useInput } from 'ink'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { exec } from 'node:child_process'
import TextInput from '../components/ui/TextInput'
import { ChatMessage } from '../components/chat/ChatMessage'

type Props = {
  onExit?: () => void
}

type Msg = {
  id: string
  role: 'user' | 'assistant'
  content: string
  rawContent?: any[]
  timestamp: Date
}

const LOG_DIR = path.resolve(process.cwd(), 'proxy/logs')
const DEBUG_LOG = path.resolve(
  LOG_DIR,
  `mychat-${new Date().toISOString().replace(/[:.]/g, '-')}.log`,
)

async function appendDebug(label: string, data: Record<string, any>) {
  try {
    await fsp.mkdir(LOG_DIR, { recursive: true })
    const line = `${new Date().toISOString()} ${label} ${JSON.stringify(data, null, 2)}\n`
    await fsp.appendFile(DEBUG_LOG, line, 'utf8')
  } catch {
    // Swallow logging errors to avoid breaking the chat loop.
  }
}

function normalizeBase(baseURL?: string): string {
  const raw = baseURL || ''
  if (!raw) return ''
  const trimmed = raw.replace(/\/+$/, '')
  return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`
}

function loadTools() {
  try {
    const p = path.resolve(process.cwd(), 'proxy/tools.json')
    const raw = fs.readFileSync(p, 'utf8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed?.tools) ? parsed.tools : []
  } catch {
    return []
  }
}

const TOOLS = loadTools()

async function runLocalTool(call: any) {
  const name = call?.name
  const input = call?.input || {}
  try {
    switch (name) {
      case 'Read': {
        const filePath = input.file_path || input.path
        if (!filePath) throw new Error('Missing file_path')
        const content = await fsp.readFile(filePath, 'utf8')
        return content
      }
      case 'Glob': {
        const pattern = input.pattern || input.glob || input.path
        const root = input.cwd || process.cwd()
        if (!pattern) throw new Error('Missing pattern')

        const regex = new RegExp(
          '^' +
            pattern
              .split('/')
              .map((seg: string) => {
                if (seg === '**') return '(?:.*)'
                return seg
                  .replace(/[.+^${}()|[\\]\\\\]/g, '\\\\$&')
                  .replace(/\\*/g, '[^/]*')
              })
              .join('/') +
            '$',
        )

        const results: string[] = []
        async function walk(dir: string) {
          const entries = await fsp.readdir(dir, { withFileTypes: true })
          for (const ent of entries) {
            const full = path.join(dir, ent.name)
            const rel = path.relative(root, full) || ent.name
            if (regex.test(rel)) results.push(full)
            if (ent.isDirectory()) await walk(full)
          }
        }
        await walk(root)
        return results.length ? results.join('\n') : 'No files found'
      }
      case 'Bash': {
        const cmd = input.command
        const timeout = typeof input.timeout === 'number' ? input.timeout : 30000
        if (!cmd) throw new Error('Missing command')
        const cwd = input.cwd || process.cwd()
        const env = { ...process.env, ...(input.env || {}) }
        const execResult = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
          exec(cmd, { cwd, env, timeout }, (err, stdout, stderr) => {
            if (err) reject(err)
            else resolve({ stdout, stderr })
          })
        })
        if (execResult.stderr) {
          return `stderr:\\n${execResult.stderr}\\nstdout:\\n${execResult.stdout}`
        }
        return execResult.stdout || '(no output)'
      }
      case 'Write': {
        const filePath = input.file_path || input.path
        let content = input.content
        if (!filePath) throw new Error('Missing file_path')
        if (Array.isArray(content)) {
          content = content
            .map((c: any) =>
              typeof c === 'string'
                ? c
                : c?.text || (typeof c === 'object' ? JSON.stringify(c) : ''),
            )
            .join('')
        }
        if (content === undefined || content === null) content = ''
        const dir = path.dirname(filePath)
        await fsp.mkdir(dir, { recursive: true })
        await fsp.writeFile(filePath, String(content), 'utf8')
        return `Wrote ${filePath} (${String(content).length} bytes)`
      }
      default:
        return `Tool ${name} not implemented`
    }
  } catch (e: any) {
    return `Tool ${name} error: ${e?.message || e}`
  }
}

/**
 * Minimal chat screen used by my-cli.
 * - No onboarding or model manager dependencies.
 * - Anthropic-compatible only, takes API key/baseURL/model from env.
 */
export function MyChatScreen({ onExit }: Props): React.ReactNode {
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useInput((key, meta) => {
    if (meta.ctrl && key === 'c') {
      onExit ? onExit() : process.exit(0)
    }
  })

  const callAnthropic = useCallback(
    async (history: Msg[], pushText: (text: string) => void): Promise<void> => {
    const apiKey = process.env.ANTHROPIC_API_KEY2
    const baseURL = normalizeBase(process.env.ANTHROPIC_BASE_URL2)
    const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5-20250929'
    if (!apiKey) throw new Error('Missing ANTHROPIC_API_KEY2')
    if (!baseURL) throw new Error('Missing ANTHROPIC_BASE_URL2')

    const payload = {
      stream: false, // align with proxy/test-1.js default
      model,
      messages: history.map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.rawContent ?? [{ type: 'text', text: m.content }],
      })),
      system: [
        {
          type: 'text',
          text: "You are Claude Code, Anthropic's official CLI for Claude.",
          cache_control: { type: 'ephemeral' },
        },
      ],
      tools: TOOLS,
    }

    const headers = {
      accept: 'application/json',
      'accept-encoding': 'gzip, deflate, br',
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
      "anthropic-beta": "interleaved-thinking-2025-05-14",
      'anthropic-dangerous-direct-browser-access': 'true',
      'x-api-key': apiKey,
      Authorization: `Bearer ${apiKey}`,
      'user-agent': 'claude-cli/2.0.74 (external, claude-vscode, agent-sdk/0.1.75)',
      'x-app': 'cli',
      'x-stainless-arch': process.arch || 'arm64',
      'x-stainless-helper-method': 'stream',
      'x-stainless-lang': 'js',
      'x-stainless-os': process.platform === 'darwin' ? 'MacOS' : process.platform,
      'x-stainless-package-version': '0.70.0',
      'x-stainless-retry-count': '0',
      'x-stainless-runtime': 'node',
      'x-stainless-runtime-version': 'v24.3.0',
      'x-stainless-timeout': '3000',
    } as Record<string, string>

    let loopMessages: any[] = payload.messages
    let i = 0
    while (true) {
      await appendDebug('loop_start', {
        iteration: i,
        messageCount: loopMessages.length,
      })

      const body = {
        ...payload,
        messages: loopMessages,
      }

      await appendDebug('anthropic_request', { baseURL, body, headers })

      const timeoutMs = Number(process.env.ANTHROPIC_TIMEOUT_MS || 12000000)
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), timeoutMs)
      let rawText = ''
      let data: any
      try {
        const resp = await fetch(`${baseURL}/messages`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: controller.signal,
        })

        rawText = await resp.text()
        await appendDebug('anthropic_response', {
          status: resp.status,
          statusText: resp.statusText,
          body: rawText,
        })

        if (!resp.ok) {
          throw new Error(rawText || `HTTP ${resp.status}`)
        }

        data = rawText ? JSON.parse(rawText) : {}
      } catch (e) {
        await appendDebug('anthropic_error', {
          error: String(e),
          body,
        })
        throw e
      } finally {
        clearTimeout(timeout)
      }
      const content = Array.isArray(data?.content) ? data.content : []
      const stopReason = data?.stop_reason

      const toolCalls: any[] = []
      const textParts: string[] = []

      for (const item of content) {
        if (item?.type === 'text' && typeof item.text === 'string') {
          textParts.push(item.text)
        }
        if (item?.type === 'tool_use') {
          toolCalls.push(item)
        }
      }

      if (textParts.length) {
        pushText(textParts.join(''))
      }

      await appendDebug('parsed_content', {
        iteration: i,
        textPartsCount: textParts.length,
        toolCallsCount: toolCalls.length,
        stopReason,
      })

      if (toolCalls.length === 0 || stopReason !== 'tool_use') {
        // 没有工具调用或模型返回停止信号就结束
        await appendDebug('anthropic_complete', {
          iteration: i,
          stopReason,
        })
        break
      }

      // 执行工具，生成 tool_result，再继续下一轮
      const toolResults = []
      for (const call of toolCalls) {
        await appendDebug('tool_start', { iteration: i, call })
        const result = await runLocalTool(call)
        toolResults.push({
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: call.id,
              content:
                typeof result === 'string' ? result : JSON.stringify(result),
            },
          ],
        })
        await appendDebug('tool_done', {
          iteration: i,
          tool_use_id: call.id,
          resultPreview:
            typeof result === 'string' ? result.slice(0, 200) : '[non-string]',
        })
      }

      if (toolCalls.length) {
        await appendDebug('tool_results', { toolCalls, toolResults })
      }

      // 把本轮 assistant 返回和 tool_result 都加入上下文
      loopMessages = [
        ...loopMessages,
        { role: 'assistant', content },
        ...toolResults,
      ]

      i += 1
    }
  },
    [],
  )

  const buildInitPrompt = useCallback(() => {
    return `Please analyze this codebase and create a CLAUDE.md file containing:
1. Build/lint/test commands - especially how to run a single test
2. High-level architecture/structure (big picture, not every file)

If CLAUDE.md exists, improve it. Include key points from README and any Cursor/Copilot rules if present. Do not add generic advice. Prefix with:
# CLAUDE.md
This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.
`
  }, [])

  const handleSend = useCallback(
    async (value: string) => {
      const text = value.trim()
      if (!text || isLoading) return

      const userMsg: Msg = {
        id: `user-${Date.now()}`,
        role: 'user',
        content: text,
        rawContent: undefined,
        timestamp: new Date(),
      }
      setMessages((prev) => [...prev, userMsg])
      setInput('')
      setIsLoading(true)
      setError(null)

      try {
        const conversation = [...messages, userMsg]
        const isInit = text.startsWith('/init')
        const initContent = [
          {
            type: 'text',
            text: '<command-message>init is analyzing your codebase…</command-message>\n<command-name>/init</command-name>',
          },
          { type: 'text', text: buildInitPrompt() },
        ]
        const sendHistory = isInit
          ? [...conversation.slice(0, -1), { ...userMsg, rawContent: initContent }]
          : conversation
        await callAnthropic(sendHistory, (text) => {
          const assistant: Msg = {
            id: `assistant-${Date.now()}`,
            role: 'assistant',
            content: text,
            timestamp: new Date(),
          }
          setMessages((prev) => [...prev, assistant])
        })
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Failed to send message'
        setError(msg)
        setMessages((prev) => [
          ...prev,
          {
            id: `error-${Date.now()}`,
            role: 'assistant',
            content: `❌ ${msg}`,
            timestamp: new Date(),
          },
        ])
      } finally {
        setIsLoading(false)
      }
    },
    [messages, isLoading],
  )
  return (
    <Box flexDirection="column" height="100%">
      <Text>My CLI Chat (Ctrl+C to exit)</Text>

      <Box flexDirection="column" flexGrow={1} marginTop={1}>
        {messages.map((m) => (
          <ChatMessage
            key={m.id}
            role={m.role}
            content={m.content}
            timestamp={m.timestamp}
          />
        ))}
        {isLoading && <ChatMessage role="assistant" content="" isLoading />}
        {error && !isLoading && (
          <Text color="red">Error: {error}</Text>
        )}
        {messages.length === 0 && !isLoading && (
          <Text dimColor>Type a message below to start chatting.</Text>
        )}
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <TextInput
          value={input}
          onChange={setInput}
          onSubmit={handleSend}
          placeholder="Your message..."
          focus={!isLoading}
        />
      </Box>
    </Box>
  )
}
