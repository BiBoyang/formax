import { randomUUID } from 'node:crypto'
import type { PromptMessage } from '../../prompts/index.js'
import { query } from '../query.js'
import type { QueryMessage, ResultMessage, SDKSession, SDKSessionOptions, SDKUserMessage } from '../types.js'

type SessionState = {
  sessionId: string
  options: SDKSessionOptions
  history: PromptMessage[]
  pendingPrompt: string | null
  streamActive: boolean
  initialized: boolean
  handleCount: number
}

const sessionStore = new Map<string, SessionState>()

function parseUserPrompt(message: string | SDKUserMessage): string {
  if (typeof message === 'string') return message
  if (!message || message.role !== 'user' || !Array.isArray(message.content)) {
    throw new Error('Expected a user message with role="user" and content blocks')
  }

  let combined = ''
  for (const block of message.content) {
    if (!block || typeof block !== 'object' || (block as { type?: unknown }).type !== 'text') {
      throw new Error('SDKUserMessage currently supports only text blocks')
    }
    const value = (block as { text?: unknown }).text
    if (typeof value !== 'string') {
      throw new Error('Text block must include a string text field')
    }
    combined += value
  }
  return combined
}

function rewriteSessionId(message: QueryMessage, sessionId: string): QueryMessage {
  if (message.type === 'result') {
    return {
      ...message,
      session_id: sessionId,
      assistant: message.assistant ? { ...message.assistant, session_id: sessionId } : message.assistant,
    }
  }
  return {
    ...message,
    session_id: sessionId,
  }
}

class InProcessSdkSession implements SDKSession {
  private readonly state: SessionState
  private readonly allowImmediateSessionId: boolean
  private closed = false

  constructor(state: SessionState, allowImmediateSessionId: boolean) {
    this.state = state
    this.allowImmediateSessionId = allowImmediateSessionId
    this.state.handleCount += 1
  }

  get sessionId(): string {
    if (!this.allowImmediateSessionId && !this.state.initialized) {
      throw new Error('sessionId is available after the first streamed message')
    }
    return this.state.sessionId
  }

  async send(message: string | SDKUserMessage): Promise<void> {
    if (this.closed) throw new Error('Session is closed')
    if (this.state.streamActive) throw new Error('Cannot send while stream() is running')
    if (this.state.pendingPrompt !== null) {
      throw new Error('Pending user message exists. Consume stream() first')
    }

    this.state.pendingPrompt = parseUserPrompt(message)
  }

  async *stream(): AsyncGenerator<QueryMessage, void> {
    if (this.closed) throw new Error('Session is closed')
    if (this.state.streamActive) throw new Error('stream() is already running')
    if (this.state.pendingPrompt === null) {
      throw new Error('No pending user message. Call send() before stream().')
    }

    this.state.streamActive = true
    const prompt = this.state.pendingPrompt
    this.state.pendingPrompt = null
    let didReceiveResult = false

    try {
      const sessionAwareOptions: SDKSessionOptions = this.state.options.onMessage
        ? {
            ...this.state.options,
            onMessage: (message) => {
              this.state.options.onMessage?.(rewriteSessionId(message, this.state.sessionId))
            },
          }
        : this.state.options

      for await (const message of query({
        prompt,
        history: this.state.history,
        options: sessionAwareOptions,
      })) {
        this.state.initialized = true
        const normalized = rewriteSessionId(message, this.state.sessionId)
        if (normalized.type === 'result') {
          this.state.history = normalized.history
          didReceiveResult = true
        }
        yield normalized
      }
    } finally {
      this.state.streamActive = false
    }

    if (!didReceiveResult) {
      throw new Error('Session stream ended without a terminal result message')
    }
  }

  close(): void {
    if (this.closed) return

    this.closed = true
    this.state.pendingPrompt = null
    this.state.handleCount = Math.max(0, this.state.handleCount - 1)
    if (this.state.handleCount === 0) {
      sessionStore.delete(this.state.sessionId)
    }
  }

  async [Symbol.asyncDispose](): Promise<void> {
    this.close()
  }
}

function createSessionState(args: {
  sessionId: string
  options: SDKSessionOptions
  history?: PromptMessage[]
  initialized?: boolean
}): SessionState {
  return {
    sessionId: args.sessionId,
    options: args.options,
    history: args.history ? [...args.history] : [],
    pendingPrompt: null,
    streamActive: false,
    initialized: args.initialized === true,
    handleCount: 0,
  }
}

export function unstable_v2_createSession(options: SDKSessionOptions = {}): SDKSession {
  const sessionId = randomUUID()
  const state = createSessionState({
    sessionId,
    options: { ...options },
    initialized: false,
  })
  sessionStore.set(sessionId, state)
  return new InProcessSdkSession(state, false)
}

export function unstable_v2_resumeSession(sessionId: string, options: SDKSessionOptions = {}): SDKSession {
  const existing = sessionStore.get(sessionId)
  if (!existing) {
    throw new Error(
      `Session ${sessionId} is not available in this process. Current implementation only supports in-process resume.`,
    )
  }

  if (existing.streamActive || existing.pendingPrompt !== null) {
    throw new Error('Cannot resume session while a turn is active or pending')
  }

  existing.options = { ...existing.options, ...options }
  existing.initialized = true
  return new InProcessSdkSession(existing, true)
}

export async function unstable_v2_prompt(
  message: string,
  options: SDKSessionOptions = {},
): Promise<ResultMessage> {
  const prompt = parseUserPrompt(message)
  let result: ResultMessage | null = null

  for await (const streamMessage of query({
    prompt,
    options,
  })) {
    if (streamMessage.type !== 'result') continue
    result = streamMessage
    break
  }

  if (!result) {
    throw new Error('Prompt completed without a terminal result message')
  }
  return result
}
