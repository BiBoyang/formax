export type BashRisk = 'allow' | 'confirm' | 'deny'

export type BashPolicyDecision = {
  risk: BashRisk
  prefix: string
  reason: string
  matchedRule: string
}

export function classifyBashCommand(args: {
  command: string
  mode?: 'normal' | 'acceptEdits' | 'plan'
  agentDepth?: number
}): BashPolicyDecision {
  const raw = String(args.command || '')
  const normalized = raw.trim()
  const agentDepth = Number.isFinite(args.agentDepth) ? Math.max(0, Math.floor(args.agentDepth ?? 0)) : 0
  const mode = args.mode ?? 'normal'

  const effectiveMode: 'normal' | 'acceptEdits' | 'plan' = agentDepth > 0 ? 'plan' : mode

  if (!normalized) {
    return {
      risk: 'deny',
      prefix: '',
      reason: 'Empty command',
      matchedRule: 'deny_empty',
    }
  }

  const lower = normalized.toLowerCase()

  // Hard-deny obviously destructive patterns
  if (isDestructiveRootRm(lower)) {
    return {
      risk: 'deny',
      prefix: 'rm',
      reason: 'Refusing to run destructive rm against root',
      matchedRule: 'deny_rm_root',
    }
  }

  if (/\b(mkfs|dd|shutdown|reboot|poweroff|halt)\b/.test(lower)) {
    return {
      risk: 'deny',
      prefix: 'system',
      reason: 'Refusing to run potentially destructive system command',
      matchedRule: 'deny_system',
    }
  }

  if (/\b(sudo)\b/.test(lower)) {
    return {
      risk: 'deny',
      prefix: 'sudo',
      reason: 'Refusing to run sudo from the model',
      matchedRule: 'deny_sudo',
    }
  }

  // Shell redirections are almost always writes; require explicit confirmation.
  if (/[<>]|(?:\s|^)(?:tee)\b/.test(lower)) {
    return {
      risk: 'confirm',
      prefix: inferPrefix(normalized),
      reason: effectiveMode === 'plan' ? 'Plan mode: shell redirection requires confirmation' : 'Shell redirection requires confirmation',
      matchedRule: 'confirm_redirection',
    }
  }

  const tokens = shellWords(normalized)
  const cmd = (tokens[0] || '').toLowerCase()
  const sub = (tokens[1] || '').toLowerCase()

  const prefix = cmd === 'git' && sub ? `git ${sub}` : cmd || inferPrefix(normalized)

  // Safe read-only commands
  if (isSafeReadOnly(cmd, sub)) {
    return {
      risk: 'allow',
      prefix,
      reason: 'Read-only command',
      matchedRule: 'allow_readonly',
    }
  }

  // Mutating commands: require confirmation, and in plan/sub-agent mode they are denied unless explicitly confirmed.
  const risk: BashRisk = 'confirm'
  const reason = effectiveMode === 'plan' ? 'Plan mode: command requires confirmation' : 'Command may have side effects'
  const matchedRule = 'confirm_default'

  if (isAlwaysConfirm(cmd)) {
    return { risk, prefix, reason, matchedRule: 'confirm_known_risky' }
  }

  // Default: confirm for anything unknown.
  return { risk, prefix, reason, matchedRule }
}

function isSafeReadOnly(cmd: string, sub: string): boolean {
  if (!cmd) return false

  // Basic shell utilities that read only.
  const safe = new Set([
    'pwd',
    'ls',
    'echo',
    'whoami',
    'uname',
    'date',
    'which',
    'command',
  ])

  if (safe.has(cmd)) return true

  // Prefer dedicated tools for these, but they're still read-only.
  const readOnly = new Set(['cat', 'head', 'tail', 'rg', 'grep', 'find', 'wc'])
  if (readOnly.has(cmd)) return true

  if (cmd === 'git') {
    const safeGit = new Set(['status', 'diff', 'log', 'show', 'rev-parse', 'branch'])
    return safeGit.has(sub)
  }

  return false
}

function isAlwaysConfirm(cmd: string): boolean {
  if (!cmd) return true

  // Commands commonly used for writes / installs / running arbitrary scripts.
  const confirm = new Set([
    'rm',
    'mv',
    'cp',
    'mkdir',
    'touch',
    'sed',
    'perl',
    'python',
    'python3',
    'node',
    'bun',
    'npm',
    'pnpm',
    'yarn',
    'curl',
    'wget',
    'chmod',
    'chown',
    'kill',
    'killall',
    'pkill',
    'make',
  ])

  return confirm.has(cmd)
}

function isDestructiveRootRm(lower: string): boolean {
  if (!/\brm\b/.test(lower)) return false
  if (!/(^|[\s;|&])rm[\s]+/.test(lower)) return false
  const hasRf = /(?:^|[\s;|&])rm[\s]+[^\\n]*-rf\b/.test(lower) || /(?:^|[\s;|&])rm[\s]+[^\\n]*-fr\b/.test(lower)
  if (!hasRf) return false
  if (/--no-preserve-root/.test(lower)) return true
  return /(?:^|[\s;|&])rm[\s]+[^\\n]*\s\/(?:\s|$)/.test(lower)
}

function inferPrefix(command: string): string {
  const trimmed = (command || '').trim()
  const first = trimmed.split(/\s+/, 1)[0] || ''
  return first.toLowerCase()
}

function shellWords(command: string): string[] {
  const out: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let escape = false

  const push = () => {
    if (current) out.push(current)
    current = ''
  }

  for (const ch of command) {
    if (escape) {
      current += ch
      escape = false
      continue
    }

    if (ch === '\\\\') {
      escape = true
      continue
    }

    if (quote) {
      if (ch === quote) quote = null
      else current += ch
      continue
    }

    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }

    if (/\s/.test(ch)) {
      push()
      continue
    }

    current += ch
  }

  push()
  return out
}

