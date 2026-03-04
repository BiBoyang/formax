type ShikiLanguageModule = {
  default: unknown
}

type ShikiHighlighter = {
  codeToHtml: (code: string, options: { lang: string; theme: string }) => string
  getLoadedLanguages: () => string[]
  loadLanguage: (...langs: unknown[]) => Promise<void>
}

type LanguageLoader = () => Promise<ShikiLanguageModule>

const LANGUAGE_ALIASES: Record<string, string> = {
  js: 'javascript',
  cjs: 'javascript',
  mjs: 'javascript',
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  jsx: 'jsx',
  tsx: 'tsx',
  shell: 'bash',
  sh: 'bash',
  zsh: 'bash',
  shellscript: 'bash',
  yml: 'yaml',
  md: 'markdown',
  plaintext: 'text',
  txt: 'text',
}

const LANGUAGE_LOADERS: Record<string, LanguageLoader> = {
  bash: () => import('shiki/langs/bash.mjs'),
  css: () => import('shiki/langs/css.mjs'),
  diff: () => import('shiki/langs/diff.mjs'),
  go: () => import('shiki/langs/go.mjs'),
  html: () => import('shiki/langs/html.mjs'),
  java: () => import('shiki/langs/java.mjs'),
  javascript: () => import('shiki/langs/javascript.mjs'),
  json: () => import('shiki/langs/json.mjs'),
  jsx: () => import('shiki/langs/jsx.mjs'),
  markdown: () => import('shiki/langs/markdown.mjs'),
  python: () => import('shiki/langs/python.mjs'),
  rust: () => import('shiki/langs/rust.mjs'),
  sql: () => import('shiki/langs/sql.mjs'),
  toml: () => import('shiki/langs/toml.mjs'),
  tsx: () => import('shiki/langs/tsx.mjs'),
  typescript: () => import('shiki/langs/typescript.mjs'),
  xml: () => import('shiki/langs/xml.mjs'),
  yaml: () => import('shiki/langs/yaml.mjs'),
}

const SHIKI_THEME = 'github-light'

export type MarkdownShikiRuntime = {
  highlighter: ShikiHighlighter
  ensureLanguageLoaded: (lang: string) => Promise<void>
  normalizeLanguage: (raw: string | undefined) => string
}

export function normalizeMarkdownCodeLanguage(raw: string | undefined): string {
  const normalized = (raw ?? '').trim().toLowerCase()
  if (!normalized) return 'text'

  const aliased = LANGUAGE_ALIASES[normalized] ?? normalized
  if (aliased in LANGUAGE_LOADERS) return aliased
  return 'text'
}

export async function createMarkdownShikiRuntime(): Promise<MarkdownShikiRuntime> {
  const [{ createHighlighterCore }, { createJavaScriptRegexEngine }, themeModule] = await Promise.all([
    import('shiki/core'),
    import('shiki/engine/javascript'),
    import('shiki/themes/github-light.mjs'),
  ])

  const highlighter = (await createHighlighterCore({
    engine: createJavaScriptRegexEngine(),
    themes: [themeModule.default],
  })) as ShikiHighlighter

  const loaded = new Set(highlighter.getLoadedLanguages())
  const inFlight = new Map<string, Promise<void>>()

  const ensureLanguageLoaded = async (lang: string): Promise<void> => {
    if (lang === 'text' || loaded.has(lang)) return

    const existing = inFlight.get(lang)
    if (existing) return existing

    const loader = LANGUAGE_LOADERS[lang]
    if (!loader) return

    const pending = loader()
      .then((module) => highlighter.loadLanguage(module.default))
      .then(() => {
        loaded.add(lang)
        for (const entry of highlighter.getLoadedLanguages()) {
          loaded.add(entry)
        }
      })
      .finally(() => {
        inFlight.delete(lang)
      })

    inFlight.set(lang, pending)
    return pending
  }

  return {
    highlighter,
    ensureLanguageLoaded,
    normalizeLanguage: normalizeMarkdownCodeLanguage,
  }
}

export { SHIKI_THEME }
