import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { createRuntime } from '../packages/core/src/runtime/createRuntime.js'
import { createRuntimeFlags, type RuntimeFlags } from '../packages/core/src/config/runtimeFlags.js'
import { runMainSendTurn } from '../packages/core/src/features/repl/controller/send/sendMainTurn.js'
import type { PromptBlock, PromptMessage } from '../packages/core/src/prompts/index.js'
import type { ToolDefinition } from '../packages/core/src/tools/types.js'
import { normalizeAnthropicPromptCachingLayout } from '../packages/core/src/streaming/anthropic/promptCachingLayout.js'

type CliOptions = {
  text: string
  outputDir: string | null
  deferred: boolean | null
  promptProfile: 'full' | 'lite' | null
}

type DryRunPreviewPayload = {
  kind: 'formax_request_preview_v1'
  createdAt: string
  iteration: number
  cwd: string
  model: string | null
  thinkingEnabled: boolean | null
  system: PromptBlock[]
  messages: PromptMessage[]
  tools: ToolDefinition[]
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  const cwd = process.cwd()

  const runtimeEnv = { ...process.env }
  const runtimeFlags = buildRuntimeFlags({
    env: runtimeEnv,
    deferredOverride: options.deferred,
  })
  const dryRunOutputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-request-preview-'))
  runtimeFlags.requestDryRunEnabled = true
  runtimeFlags.requestDryRunOutputDir = dryRunOutputDir

  const runtime = await createRuntime({
    cwd,
    env: runtimeEnv,
    runtimeFlags,
  })

  const replModeRef: { current: 'normal' | 'acceptEdits' | 'plan' } = { current: 'normal' }
  const historyRef = { current: [] as PromptMessage[] }
  const pendingInjectedBlocksRef = { current: [] as PromptBlock[] }
  const contextBudgetConfigRef = { current: null as any }
  const abortControllerRef = { current: null as AbortController | null }
  const assistantBufferRef = { current: '' }
  const thinkingBufferRef = { current: '' }
  const thinkingLastFlushAtRef = { current: 0 }
  const currentAssistantIdRef = { current: null as string | null }
  const pendingExitPlanReminderRef = { current: false }
  const deferredToolExposureSessionKeyRef = { current: randomUUID() }
  const sendSeqRef = { current: 0 }
  const lastAutoCompactSeqRef = { current: 0 }
  const reminderServiceRef = { current: null as any }

  let uiMessages: any[] = []
  const setMessages = (updater: any): void => {
    uiMessages = typeof updater === 'function' ? updater(uiMessages) : updater
  }

  await runMainSendTurn({
    input: {
      text: options.text,
      slashEffect: null,
      provider: runtime.cfg.llm.provider === 'openai' ? 'openai' : 'anthropic',
    },
    deps: {
      engine: runtime.engine,
      cfg: {
        ...runtime.cfg,
        ui: {
          ...runtime.cfg.ui,
          ...(options.promptProfile ? { promptProfile: options.promptProfile } : {}),
        },
      },
      promptProfile: options.promptProfile ?? undefined,
      planSession: null,
      reminderServiceRef,
      tools: runtime.tools,
      runtimeFlags,
      allowedSubagents: runtime.allowedSubagents,
      mode: replModeRef.current,
      getReplMode: () => replModeRef.current,
      setReplMode: (next) => {
        replModeRef.current = next
      },
      handleEvent: () => {
        // No-op: this script only snapshots request payloads.
      },
    },
    refs: {
      historyRef,
      pendingInjectedBlocksRef,
      contextBudgetConfigRef,
      abortControllerRef,
      assistantBufferRef,
      thinkingBufferRef,
      thinkingLastFlushAtRef,
      currentAssistantIdRef,
      pendingExitPlanReminderRef,
      deferredToolExposureSessionKeyRef,
      sendSeqRef,
      lastAutoCompactSeqRef,
    },
    state: {
      setMessages,
      setIsLoading: () => {},
      setLoadingText: () => {},
      setThinkingText: () => {},
      setError: () => {},
      setContext: () => {},
      emitCanonicalUiMessage: () => {},
    },
  })

  const previewFile = await pickSingleJsonFile(dryRunOutputDir)
  if (!previewFile) {
    throw new Error(`No request preview file was generated in ${dryRunOutputDir}`)
  }
  const previewPath = path.join(dryRunOutputDir, previewFile)
  const previewPayload = JSON.parse(await fs.readFile(previewPath, 'utf8')) as DryRunPreviewPayload

  const outDir = await ensureOutputDir(options.outputDir, cwd)
  const written = await writeProxyStyleSnapshot({
    outDir,
    provider: runtime.cfg.llm.provider,
    payload: previewPayload,
  })
  const payloadText = JSON.stringify(previewPayload.messages ?? [])
  const hasDeferredToolsBlock = payloadText.includes('<available-deferred-tools>')
  const hasSkillsReminder = payloadText.includes('<available_skills>')

  await fs.rm(dryRunOutputDir, { recursive: true, force: true })

  console.log(`Request preview generated`)
  console.log(`- logDir: ${outDir}`)
  console.log(`- raw: ${path.join(outDir, written.rawFilename)}`)
  console.log(`- simple: ${path.join(outDir, written.simpleFilename)}`)
  console.log(`- clean: ${path.join(outDir, 'clean-traffic.log')}`)
  console.log(`- hasDeferredToolsBlock: ${hasDeferredToolsBlock}`)
  console.log(`- hasSkillsReminder: ${hasSkillsReminder}`)
}

function parseArgs(argv: string[]): CliOptions {
  const out: CliOptions = {
    text: 'hello',
    outputDir: null,
    deferred: null,
    promptProfile: null,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (token === '--help' || token === '-h') {
      printHelpAndExit()
    } else if (token === '--text') {
      const value = argv[i + 1]
      if (!value) throw new Error('--text requires a value')
      out.text = value
      i += 1
    } else if (token === '--output-dir') {
      const value = argv[i + 1]
      if (!value) throw new Error('--output-dir requires a value')
      out.outputDir = value
      i += 1
    } else if (token === '--deferred') {
      out.deferred = true
    } else if (token === '--no-deferred') {
      out.deferred = false
    } else if (token === '--profile') {
      const value = argv[i + 1]
      if (value !== 'full' && value !== 'lite') {
        throw new Error('--profile must be full or lite')
      }
      out.promptProfile = value
      i += 1
    } else {
      throw new Error(`Unknown option: ${token}`)
    }
  }

  return out
}

function printHelpAndExit(): never {
  const lines = [
    'Usage: bun run request:preview -- [options]',
    '',
    'Options:',
    '  --text <content>         User input text to build request from (default: "hello")',
    '  --output-dir <path>      Optional output directory; default creates proxy/request-preview/traffic-log-<time>',
    '  --deferred               Enable deferred tool exposure for this preview',
    '  --no-deferred            Disable deferred tool exposure for this preview',
    '  --profile <full|lite>    Override prompt profile for this preview',
    '  --help                   Show this help',
  ]
  console.log(lines.join('\n'))
  process.exit(0)
}

function buildRuntimeFlags(args: {
  env: NodeJS.ProcessEnv
  deferredOverride: boolean | null
}): RuntimeFlags {
  const flags = createRuntimeFlags(args.env)
  if (args.deferredOverride !== null) {
    flags.deferredToolExposureEnabled = args.deferredOverride
  }
  return flags
}

async function pickSingleJsonFile(dir: string): Promise<string | null> {
  const files = (await fs.readdir(dir)).filter((name) => name.endsWith('.json')).sort()
  if (files.length === 0) return null
  return files[files.length - 1] ?? null
}

async function ensureOutputDir(outputDir: string | null, cwd: string): Promise<string> {
  const target = outputDir
    ? path.resolve(cwd, outputDir)
    : path.resolve(cwd, 'proxy', 'request-preview', `traffic-log-${formatLogDirTimestamp(new Date())}`)
  await fs.mkdir(target, { recursive: true })
  return target
}

type WriteSnapshotArgs = {
  outDir: string
  provider: string
  payload: DryRunPreviewPayload
}

async function writeProxyStyleSnapshot(args: WriteSnapshotArgs): Promise<{
  rawFilename: string
  simpleFilename: string
}> {
  const nowDate = new Date()
  const timestamp = nowDate.toISOString()
  const { formatted: timestampLocal, safe: timestampLocalSafe } = formatLocalTimestamp(nowDate)
  const requestPath = args.provider === 'openai' ? '/v1/chat/completions' : '/v1/messages'
  const pathPart = requestPath.replace(/[^\w.-]+/g, '_').slice(0, 60) || 'root'
  const seq = 1
  const seqStr = String(seq).padStart(4, '0')

  const normalizedPrompt =
    args.provider === 'openai'
      ? null
      : normalizeAnthropicPromptCachingLayout({
          system: args.payload.system,
          messages: args.payload.messages,
        })

  const body = {
    model: args.payload.model,
    system: normalizedPrompt?.system ?? args.payload.system,
    messages: normalizedPrompt?.messages ?? args.payload.messages,
    tools: args.payload.tools,
    stream: true,
    max_tokens: 16000,
    ...(args.payload.thinkingEnabled === null ? {} : { thinkingEnabled: args.payload.thinkingEnabled }),
  }

  const fullEntry = {
    sequence: seq,
    timestamp,
    timestampLocal,
    timestampLocalSafe,
    latencyMs: 0,
    path: requestPath,
    request: {
      headers: {
        host: 'preview.local',
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
        authorization: '***REDACTED***',
        'user-agent': 'formax-request-preview-script',
      },
      body,
    },
    response: {
      status: 'dry_run',
      body: {
        note: 'no network request sent',
        stop_reason: 'dry_run',
      },
    },
  }

  const toolNames = args.payload.tools.map((tool) => String(tool?.name || '')).filter(Boolean)
  const toolsLite = args.payload.tools.map((tool) => ({
    name: tool.name,
    description: truncateText(String(tool.description || ''), 260),
    input_schema: tool.input_schema,
  }))
  const simpleEntry = structuredClone(fullEntry) as any
  simpleEntry.request.body.tools = toolNames
  simpleEntry.request.body.toolCount = toolNames.length
  simpleEntry.request.body.toolsLite = toolsLite

  const rawFilename = `${seqStr}_${timestampLocalSafe}_REQ_${pathPart}.json`
  const rawFilePath = path.join(args.outDir, rawFilename)
  const simpleFilename = rawFilename.replace(/\.json$/, '.simple.json')
  const simpleFilePath = path.join(args.outDir, simpleFilename)
  const summary = {
    seq,
    time: timestamp,
    timeLocal: timestampLocal,
    path: requestPath,
    status: 'dry_run',
    latencyMs: 0,
    model: args.payload.model,
    stream: true,
    maxTokens: 16000,
    toolCount: toolNames.length,
    toolNames: toolNames.slice(0, 5),
    stopReason: 'dry_run',
    rawFile: rawFilename,
  }

  await fs.writeFile(rawFilePath, `${JSON.stringify(fullEntry, null, 2)}\n`, 'utf8')
  await fs.writeFile(simpleFilePath, `${JSON.stringify(simpleEntry, null, 2)}\n`, 'utf8')
  await fs.writeFile(path.join(args.outDir, 'clean-traffic.log'), `${JSON.stringify(summary)}\n`, 'utf8')

  return { rawFilename, simpleFilename }
}

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  const prefix = text.slice(0, Math.max(0, maxChars - 22))
  return `${prefix}...(truncated ${text.length})`
}

function formatLogDirTimestamp(now: Date): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: process.env.LOG_TZ || 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
    .format(now)
    .replace(' ', 'T')
    .replace(/[:.]/g, '-')
}

function formatLocalTimestamp(now: Date): { formatted: string; safe: string } {
  const formatted = new Intl.DateTimeFormat('sv-SE', {
    timeZone: process.env.LOG_TZ || 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
    hour12: false,
  })
    .format(now)
    .replace(' ', 'T')

  return {
    formatted,
    safe: formatted.replace(/[:.]/g, '-'),
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
