import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react'
import type { UiLanguage } from '../core/userSettings'
import { GUI_MESSAGES, type GuiMessageKey } from './messages'

type I18nParams = Record<string, string | number>
export type I18nTranslator = (key: GuiMessageKey, params?: I18nParams) => string

type I18nContextValue = {
  language: UiLanguage
  t: I18nTranslator
}

const FALLBACK_LANGUAGE: UiLanguage = 'zh-CN'

function interpolate(template: string, params?: I18nParams): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = params[key]
    if (value == null) return ''
    return String(value)
  })
}

function createTranslator(language: UiLanguage): I18nTranslator {
  const catalog = GUI_MESSAGES[language] ?? GUI_MESSAGES[FALLBACK_LANGUAGE]
  return (key, params) => interpolate(catalog[key], params)
}

const defaultContextValue: I18nContextValue = {
  language: FALLBACK_LANGUAGE,
  t: createTranslator(FALLBACK_LANGUAGE),
}

const I18nContext = createContext<I18nContextValue>(defaultContextValue)

export type I18nProviderProps = {
  language: UiLanguage
  children: ReactNode
}

export function I18nProvider({ language, children }: I18nProviderProps) {
  const normalizedLanguage: UiLanguage = language in GUI_MESSAGES ? language : FALLBACK_LANGUAGE
  const t = useCallback<I18nTranslator>((key, params) => {
    const catalog = GUI_MESSAGES[normalizedLanguage] ?? GUI_MESSAGES[FALLBACK_LANGUAGE]
    return interpolate(catalog[key], params)
  }, [normalizedLanguage])

  const value = useMemo<I18nContextValue>(() => ({ language: normalizedLanguage, t }), [normalizedLanguage, t])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nContextValue {
  return useContext(I18nContext)
}
