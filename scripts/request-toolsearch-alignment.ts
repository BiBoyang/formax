import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { createRuntime } from '../src/runtime/createRuntime.js'
import { createRuntimeFlags } from '../src/config/runtimeFlags.js'
import { runMainSendTurn } from '../src/features/repl/controller/send/sendMainTurn.js'
import { getDeferredToolExposureStore } from '../src/tools/runtime/deferredToolExposure.js'
import type { PromptBlock, PromptMessage } from '../src/prompts/index.js'
import type { ToolDefinition } from '../src/tools/types.js'

type CliOptions = {
  text: string
  outputDir: string | null
  deferred: boolean
  promptProfile: 'full' | 'lite' | null
  toolName: string
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

type AlignmentCheck = {
  id: string
  pass: boolean
  detail: string
}

type AlignmentReport = {
  kind: 'formax_toolsearch_alignment_report_v1'
  createdAt: string
  cwd: string
  provider: string
  deferredToolExposureEnabled: boolean
  toolName: string
  outputDir: string
  turnSummaries: Array<{
    turn: number
    toolNames: string[]
    toolCount: number
    hasDeferredToolsBlock: boolean
    hasSkillsReminder: boolean
    hasToolReferenceForTarget: boolean
    targetToolDeferLoading: boolean
  }>
  checks: AlignmentCheck[]
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  const cwd = process.cwd()
  const runtimeEnv = { ...process.env }
  const runtimeFlags = createRuntimeFlags(runtimeEnv)
  runtimeFlags.deferredToolExposureEnabled = options.deferred
  runtimeFlags.requestDryRunEnabled = true
  const dryRunOutputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-request-align-'))
  runtimeFlags.requestDryRunOutputDir = dryRunOutputDir

  const runtime = await createRuntime({
    cwd,
    env: runtimeEnv,
    runtimeFlags,
  })

  const harness = createSendTurnHarness()
  const runTurn = async (text: string): Promise<DryRunPreviewPayload> => {
    const before = await listJsonFiles(dryRunOutputDir)
    await runMainSendTurn({
      input: {
        text,
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
        reminderServiceRef: harness.reminderServiceRef,
        tools: runtime.tools,
        runtimeFlags,
        allowedSubagents: runtime.allowedSubagents,
        mode: harness.replModeRef.current,
        getReplMode: () => harness.replModeRef.current,
        setReplMode: (next) => {
          harness.replModeRef.current = next
        },
        handleEvent: () => {
          // dry-run only; no stream event wiring needed
        },
      },
      refs: {
        historyRef: harness.historyRef,
        pendingInjectedBlocksRef: harness.pendingInjectedBlocksRef,
        contextBudgetConfigRef: harness.contextBudgetConfigRef,
        abortControllerRef: harness.abortControllerRef,
        assistantBufferRef: harness.assistantBufferRef,
        thinkingBufferRef: harness.thinkingBufferRef,
        thinkingLastFlushAtRef: harness.thinkingLastFlushAtRef,
        currentAssistantIdRef: harness.currentAssistantIdRef,
        pendingExitPlanReminderRef: harness.pendingExitPlanReminderRef,
        deferredToolExposureSessionKeyRef: harness.deferredToolExposureSessionKeyRef,
        sendSeqRef: harness.sendSeqRef,
        lastAutoCompactSeqRef: harness.lastAutoCompactSeqRef,
      },
      state: {
        setMessages: harness.setMessages,
        setIsLoading: () => {},
        setLoadingText: () => {},
        setThinkingText: () => {},
        setError: () => {},
        setContext: () => {},
        emitCanonicalUiMessage: () => {},
      },
    })

    const after = await listJsonFiles(dryRunOutputDir)
    const fileName = after.find((name) => !before.includes(name)) ?? after[after.length - 1]
    if (!fileName) throw new Error(`No dry-run preview file generated in ${dryRunOutputDir}`)
    const payload = JSON.parse(
      await fs.readFile(path.join(dryRunOutputDir, fileName), 'utf8'),
    ) as DryRunPreviewPayload
    return payload
  }

  const turn1 = await runTurn(options.text)

  const query = `select:${options.toolName}`
  const toolUseId = `call_toolsearch_${randomUUID().replaceAll('-', '').slice(0, 10)}`
  const store = getDeferredToolExposureStore()
  const sessionKey = harness.deferredToolExposureSessionKeyRef.current
  const loadResult = store.searchAndLoad({
    sessionKey,
    query,
  })
  if (loadResult.isError) {
    throw new Error(`ToolSearch preload failed for ${query}`)
  }

  harness.historyRef.current = [
    {
      role: 'assistant',
      content: [
        {
          type: 'tool_use',
          id: toolUseId,
          name: 'ToolSearch',
          input: { query },
        },
      ],
    },
    {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: toolUseId,
          content: loadResult.content,
        },
      ],
    },
  ]

  const turn2 = await runTurn(options.text)

  const outDir = await ensureOutputDir(options.outputDir, cwd)
  const provider = runtime.cfg.llm.provider
  const turn1Files = await writeProxyStyleSnapshot({
    outDir,
    provider,
    payload: turn1,
    sequence: 1,
  })
  const turn2Files = await writeProxyStyleSnapshot({
    outDir,
    provider,
    payload: turn2,
    sequence: 2,
  })

  const report = buildAlignmentReport({
    cwd,
    provider,
    deferredToolExposureEnabled: options.deferred,
    toolName: options.toolName,
    outputDir: outDir,
    turn1,
    turn2,
  })

  const reportJsonPath = path.join(outDir, 'alignment-report.json')
  const reportMdPath = path.join(outDir, 'alignment-report.md')
  await fs.writeFile(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  await fs.writeFile(reportMdPath, `${renderReportMarkdown(report)}\n`, 'utf8')
  await fs.rm(dryRunOutputDir, { recursive: true, force: true })

  const passed = report.checks.filter((check) => check.pass).length
  const total = report.checks.length
  console.log('ToolSearch alignment preview generated')
  console.log(`- logDir: ${outDir}`)
  console.log(`- turn1 raw: ${path.join(outDir, turn1Files.rawFilename)}`)
  console.log(`- turn2 raw: ${path.join(outDir, turn2Files.rawFilename)}`)
  console.log(`- clean: ${path.join(outDir, 'clean-traffic.log')}`)
  console.log(`- report(json): ${reportJsonPath}`)
  console.log(`- report(md): ${reportMdPath}`)
  console.log(`- checks: ${passed}/${total} passed`)
}

function parseArgs(argv: string[]): CliOptions {
  const out: CliOptions = {
    text: '执行下 pwd',
    outputDir: null,
    deferred: true,
    promptProfile: null,
    toolName: 'Bash',
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
    } else if (token === '--tool') {
      const value = argv[i + 1]
      if (!value) throw new Error('--tool requires a value')
      out.toolName = value
      i += 1
    } else {
      throw new Error(`Unknown option: ${token}`)
    }
  }

  return out
}

function printHelpAndExit(): never {
  const lines = [
    'Usage: bun run request:align:toolsearch -- [options]',
    '',
    'Options:',
    '  --text <content>         User input text for each turn (default: "执行下 pwd")',
    '  --tool <name>            Target tool to preload via ToolSearch (default: Bash)',
    '  --output-dir <path>      Optional output directory',
    '  --deferred               Enable deferred tool exposure (default)',
    '  --no-deferred            Disable deferred tool exposure',
    '  --profile <full|lite>    Override prompt profile',
    '  --help                   Show this help',
  ]
  console.log(lines.join('\n'))
  process.exit(0)
}

async function listJsonFiles(dir: string): Promise<string[]> {
  return (await fs.readdir(dir))
    .filter((name) => name.endsWith('.json'))
    .sort()
}

async function ensureOutputDir(outputDir: string | null, cwd: string): Promise<string> {
  const target = outputDir
    ? path.resolve(cwd, outputDir)
    : path.resolve(cwd, 'proxy', 'request-preview', `toolsearch-alignment-${formatLogDirTimestamp(new Date())}`)
  await fs.mkdir(target, { recursive: true })
  return target
}

type WriteSnapshotArgs = {
  outDir: string
  provider: string
  payload: DryRunPreviewPayload
  sequence: number
}

async function writeProxyStyleSnapshot(args: WriteSnapshotArgs): Promise<{ rawFilename: string; simpleFilename: string }> {
  const nowDate = new Date()
  const timestamp = nowDate.toISOString()
  const { formatted: timestampLocal, safe: timestampLocalSafe } = formatLocalTimestamp(nowDate)
  const requestPath = args.provider === 'openai' ? '/v1/chat/completions' : '/v1/messages'
  const pathPart = requestPath.replace(/[^\w.-]+/g, '_').slice(0, 60) || 'root'
  const seqStr = String(args.sequence).padStart(4, '0')

  const body = {
    model: args.payload.model,
    system: args.payload.system,
    messages: args.payload.messages,
    tools: args.payload.tools,
    stream: true,
    max_tokens: 16000,
    ...(args.payload.thinkingEnabled === null ? {} : { thinkingEnabled: args.payload.thinkingEnabled }),
  }

  const fullEntry = {
    sequence: args.sequence,
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
        'user-agent': 'formax-toolsearch-alignment-script',
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
    ...(tool.defer_loading === true ? { defer_loading: true } : {}),
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
    seq: args.sequence,
    time: timestamp,
    timeLocal: timestampLocal,
    path: requestPath,
    status: 'dry_run',
    latencyMs: 0,
    model: args.payload.model,
    stream: true,
    maxTokens: 16000,
    toolCount: toolNames.length,
    toolNames,
    stopReason: 'dry_run',
    rawFile: rawFilename,
  }

  await fs.writeFile(rawFilePath, `${JSON.stringify(fullEntry, null, 2)}\n`, 'utf8')
  await fs.writeFile(simpleFilePath, `${JSON.stringify(simpleEntry, null, 2)}\n`, 'utf8')
  await fs.appendFile(path.join(args.outDir, 'clean-traffic.log'), `${JSON.stringify(summary)}\n`, 'utf8')

  return { rawFilename, simpleFilename }
}

function buildAlignmentReport(args: {
  cwd: string
  provider: string
  deferredToolExposureEnabled: boolean
  toolName: string
  outputDir: string
  turn1: DryRunPreviewPayload
  turn2: DryRunPreviewPayload
}): AlignmentReport {
  const turn1Tools = args.turn1.tools.map((tool) => tool.name)
  const turn2Tools = args.turn2.tools.map((tool) => tool.name)
  const turn1HasDeferred = containsText(args.turn1.messages, '<available-deferred-tools>')
  const turn2HasDeferred = containsText(args.turn2.messages, '<available-deferred-tools>')
  const turn1HasSkills = containsText(args.turn1.messages, '<available_skills>')
  const turn2HasSkills = containsText(args.turn2.messages, '<available_skills>')
  const turn1HasRef = hasToolReference(args.turn1.messages, args.toolName)
  const turn2HasRef = hasToolReference(args.turn2.messages, args.toolName)
  const turn2TargetDef = args.turn2.tools.find((tool) => tool.name === args.toolName)
  const turn2TargetDefer = turn2TargetDef?.defer_loading === true

  const checks: AlignmentCheck[] = [
    {
      id: 'turn1_only_toolsearch_exposed',
      pass: turn1Tools.length === 1 && turn1Tools[0] === 'ToolSearch',
      detail: `turn1 tools: ${turn1Tools.join(', ') || '(none)'}`,
    },
    {
      id: 'turn1_contains_available_deferred_tools_block',
      pass: turn1HasDeferred,
      detail: `turn1 has <available-deferred-tools>: ${turn1HasDeferred}`,
    },
    {
      id: 'turn2_contains_tool_reference_for_target',
      pass: turn2HasRef,
      detail: `turn2 has tool_reference(${args.toolName}): ${turn2HasRef}`,
    },
    {
      id: 'turn2_exposes_target_tool_and_toolsearch',
      pass: turn2Tools.includes('ToolSearch') && turn2Tools.includes(args.toolName),
      detail: `turn2 tools: ${turn2Tools.join(', ') || '(none)'}`,
    },
    {
      id: 'turn2_target_tool_marked_defer_loading',
      pass: turn2TargetDefer,
      detail: `turn2 ${args.toolName}.defer_loading: ${turn2TargetDefer}`,
    },
  ]

  return {
    kind: 'formax_toolsearch_alignment_report_v1',
    createdAt: new Date().toISOString(),
    cwd: args.cwd,
    provider: args.provider,
    deferredToolExposureEnabled: args.deferredToolExposureEnabled,
    toolName: args.toolName,
    outputDir: args.outputDir,
    turnSummaries: [
      {
        turn: 1,
        toolNames: turn1Tools,
        toolCount: turn1Tools.length,
        hasDeferredToolsBlock: turn1HasDeferred,
        hasSkillsReminder: turn1HasSkills,
        hasToolReferenceForTarget: turn1HasRef,
        targetToolDeferLoading: false,
      },
      {
        turn: 2,
        toolNames: turn2Tools,
        toolCount: turn2Tools.length,
        hasDeferredToolsBlock: turn2HasDeferred,
        hasSkillsReminder: turn2HasSkills,
        hasToolReferenceForTarget: turn2HasRef,
        targetToolDeferLoading: turn2TargetDefer,
      },
    ],
    checks,
  }
}

function renderReportMarkdown(report: AlignmentReport): string {
  const lines: string[] = []
  lines.push('# ToolSearch Alignment Report')
  lines.push('')
  lines.push(`- generatedAt: ${report.createdAt}`)
  lines.push(`- cwd: ${report.cwd}`)
  lines.push(`- provider: ${report.provider}`)
  lines.push(`- deferredToolExposureEnabled: ${report.deferredToolExposureEnabled}`)
  lines.push(`- targetTool: ${report.toolName}`)
  lines.push('')
  lines.push('## Turns')
  lines.push('')
  for (const turn of report.turnSummaries) {
    lines.push(`### Turn ${turn.turn}`)
    lines.push(`- tools: ${turn.toolNames.join(', ') || '(none)'}`)
    lines.push(`- hasDeferredToolsBlock: ${turn.hasDeferredToolsBlock}`)
    lines.push(`- hasSkillsReminder: ${turn.hasSkillsReminder}`)
    lines.push(`- hasToolReferenceForTarget: ${turn.hasToolReferenceForTarget}`)
    lines.push(`- targetToolDeferLoading: ${turn.targetToolDeferLoading}`)
    lines.push('')
  }
  lines.push('## Checks')
  lines.push('')
  for (const check of report.checks) {
    const status = check.pass ? 'PASS' : 'FAIL'
    lines.push(`- [${status}] ${check.id}: ${check.detail}`)
  }
  return lines.join('\n')
}

function containsText(messages: PromptMessage[], needle: string): boolean {
  return JSON.stringify(messages).includes(needle)
}

function hasToolReference(messages: PromptMessage[], toolName: string): boolean {
  for (const message of messages) {
    if (!message || !Array.isArray(message.content)) continue
    for (const block of message.content) {
      if (!block || typeof block !== 'object') continue
      if ((block as any).type !== 'tool_result') continue
      const content = (block as any).content
      if (!Array.isArray(content)) continue
      for (const item of content) {
        if (!item || typeof item !== 'object') continue
        if ((item as any).type !== 'tool_reference') continue
        const name = String((item as any).tool_name || (item as any).name || '')
        if (name === toolName) return true
      }
    }
  }
  return false
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

function createSendTurnHarness() {
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

  return {
    replModeRef,
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
    reminderServiceRef,
    setMessages,
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
