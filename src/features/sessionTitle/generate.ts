import type { ChatEngine, ChatHistory } from '../../chat/engine'

function flattenTextContent(content: unknown): string {
  if (!Array.isArray(content)) return ''
  const chunks: string[] = []
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    if ((block as { type?: unknown }).type !== 'text') continue
    const text = (block as { text?: unknown }).text
    if (typeof text !== 'string') continue
    const trimmed = text.trim()
    if (!trimmed) continue
    chunks.push(trimmed)
  }
  return chunks.join('\n\n')
}

function extractLastAssistantText(history: ChatHistory): string {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const msg = history[i]
    if (!msg || msg.role !== 'assistant') continue
    const text = flattenTextContent(msg.content)
    if (text) return text
  }
  return ''
}

export function normalizeSessionTitle(raw: string): string | null {
  const normalized = raw
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!normalized) return null
  if (normalized.length <= 50) return normalized
  return normalized.slice(0, 50).trimEnd()
}

const CLAUDE_TITLE_SYSTEM_PROMPTS = [
  "You are Claude Code, Anthropic's official CLI for Claude.",
  'Summarize this coding conversation in under 50 characters. Capture the main task, key files, problems addressed, and current status.',
]

const CLAUDE_TOPIC_SYSTEM_PROMPTS = [
  "You are Claude Code, Anthropic's official CLI for Claude.",
  "Analyze if this message indicates a new conversation topic. If it does, extract a 2-3 word title that captures the new topic. Format your response as a JSON object with two fields: 'isNewTopic' (boolean) and 'title' (string, or null if isNewTopic is false). Only include these fields, no other text. ONLY generate the JSON object, no other text (eg. no markdown).",
]

export type GenerateSessionTitleArgs = {
  engine: Pick<ChatEngine, 'runTurn'>
  cwd: string
  userText: string
  assistantText?: string | null
  signal?: AbortSignal
}

export async function generateSessionTitle(args: GenerateSessionTitleArgs): Promise<string | null> {
  const userText = String(args.userText ?? '').trim()
  if (!userText) return null

  const assistantText = String(args.assistantText ?? '').trim()
  const conversationLines = [`User: ${userText}`]
  if (assistantText) {
    conversationLines.push(`Assistant: ${assistantText}`)
  }

  const titlePrompt = [
    'Please write a 5-10 word title for the following conversation:',
    '',
    ...conversationLines,
    '',
    'Respond with the title for the conversation and nothing else.',
  ].join('\n')

  let streamedAssistantText = ''
  const titleHistory = await args.engine.runTurn({
    history: [],
    user: {
      role: 'user',
      content: [{ type: 'text', text: titlePrompt }],
    },
    system: CLAUDE_TITLE_SYSTEM_PROMPTS.map((text) => ({ type: 'text' as const, text })),
    tools: [],
    onEvent(event) {
      if (event.type === 'assistant_delta') streamedAssistantText += event.text
    },
    cwd: args.cwd,
    signal: args.signal,
    thinkingEnabled: false,
    exec: { interactive: false },
  })

  const candidate = normalizeSessionTitle(streamedAssistantText || extractLastAssistantText(titleHistory))
  return candidate
}

export function extractLastAssistantTextFromHistory(history: ChatHistory): string | null {
  const text = extractLastAssistantText(history)
  return text || null
}

function parseTopicDecision(raw: string): { isNewTopic: boolean; title: string | null } | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const payload = trimmed.startsWith('{') ? trimmed : `{${trimmed}`
  try {
    const parsed = JSON.parse(payload) as { isNewTopic?: unknown; title?: unknown }
    if (typeof parsed.isNewTopic !== 'boolean') return null
    const title = typeof parsed.title === 'string' ? normalizeSessionTitle(parsed.title) : null
    return { isNewTopic: parsed.isNewTopic, title: parsed.isNewTopic ? title : null }
  } catch {
    return null
  }
}

export type DetectNewTopicArgs = {
  engine: Pick<ChatEngine, 'runTurn'>
  cwd: string
  userText: string
  signal?: AbortSignal
}

export async function detectNewTopicTitleCandidate(args: DetectNewTopicArgs): Promise<{
  isNewTopic: boolean
  title: string | null
} | null> {
  const userText = String(args.userText ?? '').trim()
  if (!userText) return null

  let streamedAssistantText = ''
  const history = await args.engine.runTurn({
    history: [],
    user: {
      role: 'user',
      content: [
        {
          type: 'text',
          text: `${userText}\n\nThe first character of your response must be '{'.`,
        },
      ],
    },
    system: CLAUDE_TOPIC_SYSTEM_PROMPTS.map((text) => ({ type: 'text' as const, text })),
    tools: [],
    onEvent(event) {
      if (event.type === 'assistant_delta') streamedAssistantText += event.text
    },
    cwd: args.cwd,
    signal: args.signal,
    thinkingEnabled: false,
    exec: { interactive: false },
  })

  return parseTopicDecision(streamedAssistantText || extractLastAssistantText(history))
}
