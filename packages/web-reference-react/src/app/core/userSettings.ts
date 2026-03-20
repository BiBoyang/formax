export type OpenTarget = 'vscode' | 'cursor' | 'antigravity' | 'finder' | 'terminal' | 'iterm2' | 'xcode'
export type UiLanguage = 'zh-CN' | 'en-US' | 'ja-JP'

export type OpenTargetOption = {
  id: OpenTarget
  label: string
}

export const DEFAULT_OPEN_TARGET_OPTIONS: OpenTargetOption[] = [
  { id: 'vscode', label: 'VS Code' },
  { id: 'cursor', label: 'Cursor' },
  { id: 'antigravity', label: 'Antigravity' },
  { id: 'finder', label: 'Finder' },
  { id: 'terminal', label: 'Terminal' },
  { id: 'iterm2', label: 'iTerm2' },
  { id: 'xcode', label: 'Xcode' },
]

export type UserSettings = {
  defaultOpenTarget: OpenTarget
  language: UiLanguage
  preventSleep: boolean
  longTextRequireCmdEnter: boolean
}

export type UpdateUserSetting = <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => void

export const DEFAULT_USER_SETTINGS: UserSettings = {
  defaultOpenTarget: 'vscode',
  language: 'zh-CN',
  preventSleep: true,
  longTextRequireCmdEnter: false,
}

const LONG_PROMPT_TEXT_THRESHOLD = 120

export function shouldTreatAsLongPrompt(inputText: string): boolean {
  const normalized = inputText.trim()
  if (normalized.length >= LONG_PROMPT_TEXT_THRESHOLD) return true
  return normalized.includes('\n')
}
