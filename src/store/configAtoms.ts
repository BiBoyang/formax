import { atom } from 'jotai'
import { atomWithImmer } from 'jotai-immer'
import { getGlobalConfig, type AppConfig } from '../utils/config'
import type { ThemeName } from '../utils/theme'

// Re-export ThemeName for backward compatibility
export type { ThemeName }

// Re-export AppConfig (which is now an alias for GlobalConfig)
export type { AppConfig }

// Initialize config atom from file
const initialConfig = getGlobalConfig()

// 使用 atomWithImmer 创建配置 atom，从文件加载初始值
export const configAtom = atomWithImmer<AppConfig>({
  theme: initialConfig.theme,
  hasCompletedOnboarding: initialConfig.hasCompletedOnboarding ?? false,
  model: initialConfig.model,
})

// 辅助 atoms（用于派生状态）
export const themeAtom = atom(
  (get) => get(configAtom).theme,
  (get, set, theme: ThemeName) => {
    set(configAtom, (draft) => {
      draft.theme = theme
    })
  }
)

export const hasCompletedOnboardingAtom = atom(
  (get) => get(configAtom).hasCompletedOnboarding ?? false,
  (get, set, completed: boolean) => {
    set(configAtom, (draft) => {
      draft.hasCompletedOnboarding = completed
    })
  }
)

