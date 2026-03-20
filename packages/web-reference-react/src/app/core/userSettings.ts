export type OpenTarget = 'cursor' | 'vscode' | 'finder'
export type UiLanguage = 'zh-CN' | 'en-US' | 'ja-JP'

export type UserSettings = {
  defaultOpenTarget: OpenTarget
  language: UiLanguage
  preventSleep: boolean
  longTextRequireCmdEnter: boolean
}

export type UpdateUserSetting = <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => void

export const DEFAULT_USER_SETTINGS: UserSettings = {
  defaultOpenTarget: 'cursor',
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
