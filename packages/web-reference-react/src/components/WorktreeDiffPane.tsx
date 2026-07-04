import { ChevronDown, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { WorkerPoolOptions } from '@pierre/diffs/react'
import { useI18n } from '../app/i18n/I18nProvider'
import type { RequestCollapseSummary } from '../types'
import { cn } from '../lib/utils'
import { CodexFileTreeIconSprite } from './diff/CodexFileTreeIconSprite'
import { DiffPatchView, type DiffRenderStyle } from './diff/DiffPatchView'
import { type DiffFileViewModel } from './diff/diffTypes'

type DiffFile = DiffFileViewModel
type PatchErrorKind = 'unavailable' | 'load_failed'
type PreviewErrorKind = 'unavailable' | 'load_failed'

export type DiffFilePreviewPayload = {
  path: string
  found: boolean
  preview: {
    kind: 'image'
    mimeType: string
    dataUrl: string
    sizeBytes: number
    source?: 'working_tree' | 'head'
    changeKind?: 'added' | 'modified' | 'deleted'
  } | null
  error?: string
}

type ImagePreviewState =
  | { status: 'idle' }
  | { status: 'loading'; requestKey: string }
  | { status: 'ready'; requestKey: string; preview: NonNullable<DiffFilePreviewPayload['preview']> }
  | { status: 'error'; requestKey: string; error: PreviewErrorKind }

export type DiffSnapshot = {
  cwd: string
  generatedAt: string
  hasChanges: boolean
  truncated: boolean
  files: DiffFile[]
}

export type DiffFilePatchPayload = {
  path: string
  found: boolean
  truncated: boolean
  patch: string
  additions: number
  deletions: number
  untracked?: boolean
}


export type WorktreeDiffPaneProps = {
  activeThreadId?: string | null
  diffSnapshot?: DiffSnapshot | null
  latestRequestCollapse?: RequestCollapseSummary | null
  onRefreshDiff?: () => void
  onRequestPatch?: (filePath: string) => Promise<DiffFilePatchPayload | null>
  onRequestPreview?: (filePath: string) => Promise<DiffFilePreviewPayload | null>
  isRefreshingDiff?: boolean
  showHeader?: boolean
}

const MAX_RENDERABLE_DIFF_FILES = 120
const DIFF_WORKER_POOL_PROVIDER_SETTLE_MS = 50
const DIFF_VIEW_MODES: DiffRenderStyle[] = ['unified', 'split']
const PREVIEWABLE_IMAGE_EXTENSIONS = new Set(['avif', 'bmp', 'gif', 'ico', 'jpeg', 'jpg', 'png', 'webp'])
type DiffWorkerPoolModuleState = {
  status: 'ready'
  Provider: typeof import('@pierre/diffs/react').WorkerPoolContextProvider
  poolOptions: WorkerPoolOptions
} | { status: 'failed' }

type FileIconMeta = {
  className: string
  token: CodexFileIconToken
}

type CodexFileIconToken =
  | 'astro'
  | 'babel'
  | 'bash'
  | 'biome'
  | 'bootstrap'
  | 'browserslist'
  | 'bun'
  | 'c'
  | 'claude'
  | 'cpp'
  | 'css'
  | 'database'
  | 'default'
  | 'docker'
  | 'eslint'
  | 'font'
  | 'git'
  | 'go'
  | 'graphql'
  | 'html'
  | 'image'
  | 'javascript'
  | 'json'
  | 'markdown'
  | 'mcp'
  | 'nextjs'
  | 'npm'
  | 'oxc'
  | 'postcss'
  | 'prettier'
  | 'python'
  | 'react'
  | 'ruby'
  | 'rust'
  | 'sass'
  | 'stylelint'
  | 'svelte'
  | 'svg'
  | 'svgo'
  | 'swift'
  | 'table'
  | 'tailwind'
  | 'terraform'
  | 'text'
  | 'typescript'
  | 'vite'
  | 'vscode'
  | 'vue'
  | 'wasm'
  | 'webpack'
  | 'yml'
  | 'zig'
  | 'zip'

const CODEX_FILE_NAME_ICON_TOKENS: Record<string, CodexFileIconToken> = {
  '.babelrc': 'babel',
  '.babelrc.json': 'babel',
  '.bash_profile': 'bash',
  '.bashrc': 'bash',
  '.browserslistrc': 'browserslist',
  '.dockerignore': 'docker',
  '.eslintignore': 'eslint',
  '.eslintrc': 'eslint',
  '.eslintrc.cjs': 'eslint',
  '.eslintrc.js': 'eslint',
  '.eslintrc.json': 'eslint',
  '.eslintrc.yaml': 'eslint',
  '.eslintrc.yml': 'eslint',
  '.gitattributes': 'git',
  '.gitignore': 'git',
  '.gitkeep': 'git',
  '.gitmodules': 'git',
  '.oxlintrc.json': 'oxc',
  '.postcssrc': 'postcss',
  '.postcssrc.json': 'postcss',
  '.postcssrc.yaml': 'postcss',
  '.postcssrc.yml': 'postcss',
  '.prettierignore': 'prettier',
  '.prettierrc': 'prettier',
  '.prettierrc.cjs': 'prettier',
  '.prettierrc.js': 'prettier',
  '.prettierrc.json': 'prettier',
  '.prettierrc.mjs': 'prettier',
  '.prettierrc.toml': 'prettier',
  '.prettierrc.yaml': 'prettier',
  '.prettierrc.yml': 'prettier',
  '.stylelintignore': 'stylelint',
  '.stylelintrc': 'stylelint',
  '.stylelintrc.cjs': 'stylelint',
  '.stylelintrc.js': 'stylelint',
  '.stylelintrc.json': 'stylelint',
  '.stylelintrc.mjs': 'stylelint',
  '.stylelintrc.yaml': 'stylelint',
  '.stylelintrc.yml': 'stylelint',
  '.terraform.lock.hcl': 'terraform',
  '.zprofile': 'bash',
  '.zshenv': 'bash',
  '.zshrc': 'bash',
  'babel.config.cjs': 'babel',
  'babel.config.js': 'babel',
  'babel.config.json': 'babel',
  'babel.config.mjs': 'babel',
  'biome.json': 'biome',
  'biome.jsonc': 'biome',
  'bootstrap.bundle.js': 'bootstrap',
  'bootstrap.bundle.min.js': 'bootstrap',
  'bootstrap.css': 'bootstrap',
  'bootstrap.js': 'bootstrap',
  'bootstrap.min.css': 'bootstrap',
  'bootstrap.min.js': 'bootstrap',
  'bun.lock': 'bun',
  'bun.lockb': 'bun',
  'bunfig.toml': 'bun',
  'claude.md': 'claude',
  'compose.yaml': 'docker',
  'compose.yml': 'docker',
  'docker-compose.override.yml': 'docker',
  'docker-compose.yaml': 'docker',
  'docker-compose.yml': 'docker',
  dockerfile: 'docker',
  'eslint.config.cjs': 'eslint',
  'eslint.config.js': 'eslint',
  'eslint.config.mjs': 'eslint',
  'eslint.config.mts': 'eslint',
  'eslint.config.ts': 'eslint',
  gemfile: 'ruby',
  'next.config.js': 'nextjs',
  'next.config.mjs': 'nextjs',
  'next.config.mts': 'nextjs',
  'next.config.ts': 'nextjs',
  'postcss.config.cjs': 'postcss',
  'postcss.config.js': 'postcss',
  'postcss.config.mjs': 'postcss',
  'postcss.config.ts': 'postcss',
  'prettier.config.cjs': 'prettier',
  'prettier.config.js': 'prettier',
  'prettier.config.mjs': 'prettier',
  rakefile: 'ruby',
  'readme.md': 'markdown',
  'stylelint.config.cjs': 'stylelint',
  'stylelint.config.js': 'stylelint',
  'stylelint.config.mjs': 'stylelint',
  'svgo.config.cjs': 'svgo',
  'svgo.config.js': 'svgo',
  'svgo.config.mjs': 'svgo',
  'svgo.config.ts': 'svgo',
  'tailwind.config.cjs': 'tailwind',
  'tailwind.config.js': 'tailwind',
  'tailwind.config.mjs': 'tailwind',
  'tailwind.config.ts': 'tailwind',
  'vite.config.js': 'vite',
  'vite.config.mjs': 'vite',
  'vite.config.mts': 'vite',
  'vite.config.ts': 'vite',
  'webpack.config.babel.js': 'webpack',
  'webpack.config.cjs': 'webpack',
  'webpack.config.js': 'webpack',
  'webpack.config.mjs': 'webpack',
  'webpack.config.ts': 'webpack',
}

const CODEX_FILE_EXTENSION_ICON_TOKENS: Record<string, CodexFileIconToken> = {
  '7z': 'zip',
  astro: 'astro',
  authors: 'text',
  avif: 'image',
  bash: 'bash',
  bmp: 'image',
  bz2: 'zip',
  c: 'c',
  cc: 'cpp',
  cfg: 'text',
  changelog: 'text',
  cjs: 'javascript',
  'code-workspace': 'vscode',
  conf: 'text',
  contributors: 'text',
  cpp: 'cpp',
  csh: 'bash',
  css: 'css',
  csv: 'table',
  cts: 'typescript',
  cxx: 'cpp',
  db: 'database',
  editorconfig: 'text',
  env: 'text',
  'env.development': 'text',
  'env.local': 'text',
  'env.production': 'text',
  eot: 'font',
  erb: 'ruby',
  fish: 'bash',
  gemspec: 'ruby',
  gif: 'image',
  go: 'go',
  gql: 'graphql',
  graphql: 'graphql',
  gz: 'zip',
  h: 'c',
  hh: 'cpp',
  hpp: 'cpp',
  htm: 'html',
  html: 'html',
  hxx: 'cpp',
  icns: 'image',
  ico: 'image',
  ini: 'text',
  inl: 'cpp',
  jar: 'zip',
  jpeg: 'image',
  jpg: 'image',
  js: 'javascript',
  json: 'json',
  json5: 'json',
  jsonc: 'json',
  jsonl: 'json',
  jsx: 'javascript',
  ksh: 'bash',
  less: 'css',
  license: 'text',
  log: 'text',
  markdown: 'markdown',
  mcp: 'mcp',
  md: 'markdown',
  mdx: 'markdown',
  'mdx.tsx': 'markdown',
  mjs: 'javascript',
  mm: 'cpp',
  mts: 'typescript',
  ods: 'table',
  otf: 'font',
  png: 'image',
  postcss: 'css',
  py: 'python',
  pyi: 'python',
  pyw: 'python',
  pyx: 'python',
  rake: 'ruby',
  rar: 'zip',
  rb: 'ruby',
  rs: 'rust',
  rst: 'text',
  rtf: 'text',
  sass: 'css',
  scss: 'css',
  sh: 'bash',
  sql: 'database',
  sqlite: 'database',
  sqlite3: 'database',
  styl: 'css',
  svelte: 'svelte',
  svg: 'svg',
  swift: 'swift',
  tar: 'zip',
  tf: 'terraform',
  tfstate: 'terraform',
  tfvars: 'terraform',
  tgz: 'zip',
  tif: 'image',
  tiff: 'image',
  ts: 'typescript',
  tsv: 'table',
  tsx: 'typescript',
  ttf: 'font',
  txt: 'text',
  vue: 'vue',
  war: 'zip',
  wasm: 'wasm',
  wast: 'wasm',
  wat: 'wasm',
  webp: 'image',
  woff: 'font',
  woff2: 'font',
  xhtml: 'html',
  xls: 'table',
  xlsx: 'table',
  xz: 'zip',
  yaml: 'yml',
  yml: 'yml',
  zig: 'zig',
  zip: 'zip',
  zsh: 'bash',
}

const CODEX_COMPLETE_EXTENSION_ICON_TOKENS: Record<string, CodexFileIconToken> = {
  jsx: 'react',
  sass: 'sass',
  scss: 'sass',
  tsx: 'react',
}

const CODEX_FILE_ICON_COLOR_CLASS: Record<CodexFileIconToken, string> = {
  astro: 'text-orange-500',
  babel: 'text-yellow-500',
  bash: 'text-emerald-600',
  biome: 'text-sky-600',
  bootstrap: 'text-violet-600',
  browserslist: 'text-orange-500',
  bun: 'text-amber-800',
  c: 'text-blue-600',
  claude: 'text-orange-600',
  cpp: 'text-blue-700',
  css: 'text-blue-500',
  database: 'text-sky-600',
  default: 'text-muted-foreground',
  docker: 'text-blue-500',
  eslint: 'text-violet-600',
  font: 'text-orange-500',
  git: 'text-orange-600',
  go: 'text-cyan-600',
  graphql: 'text-pink-500',
  html: 'text-orange-600',
  image: 'text-pink-500',
  javascript: 'text-yellow-600',
  json: 'text-orange-600',
  markdown: 'text-green-600',
  mcp: 'text-blue-600',
  nextjs: 'text-foreground',
  npm: 'text-red-600',
  oxc: 'text-slate-600',
  postcss: 'text-orange-600',
  prettier: 'text-purple-600',
  python: 'text-blue-600',
  react: 'text-sky-500',
  ruby: 'text-red-600',
  rust: 'text-orange-700',
  sass: 'text-pink-500',
  stylelint: 'text-indigo-600',
  svelte: 'text-orange-600',
  svg: 'text-orange-500',
  svgo: 'text-orange-500',
  swift: 'text-orange-500',
  table: 'text-green-600',
  tailwind: 'text-cyan-500',
  terraform: 'text-violet-600',
  text: 'text-muted-foreground',
  typescript: 'text-blue-600',
  vite: 'text-purple-600',
  vscode: 'text-blue-600',
  vue: 'text-emerald-600',
  wasm: 'text-violet-600',
  webpack: 'text-sky-600',
  yml: 'text-red-600',
  zig: 'text-orange-500',
  zip: 'text-amber-600',
}

function getFileName(path: string): string {
  const pathParts = path.split('/')
  return pathParts[pathParts.length - 1] ?? path
}

function getFileExtensions(fileName: string): string[] {
  const parts = fileName.toLowerCase().split('.')
  const extensions: string[] = []
  for (let index = 1; index < parts.length; index += 1) {
    extensions.push(parts.slice(index).join('.'))
  }
  return extensions
}

function resolveCodexFileIconToken(path: string): CodexFileIconToken {
  const fileName = getFileName(path)
  const lowerFileName = fileName.toLowerCase()
  const fileNameToken = CODEX_FILE_NAME_ICON_TOKENS[lowerFileName]
  if (fileNameToken) return fileNameToken

  const extensions = getFileExtensions(fileName)
  for (const extension of extensions) {
    const completeToken = CODEX_COMPLETE_EXTENSION_ICON_TOKENS[extension]
    if (completeToken) return completeToken
    const extensionToken = CODEX_FILE_EXTENSION_ICON_TOKENS[extension]
    if (extensionToken) return extensionToken
  }
  return 'default'
}

function getFileIconMeta(path: string): FileIconMeta {
  const token = resolveCodexFileIconToken(path)
  return { className: CODEX_FILE_ICON_COLOR_CLASS[token], token }
}


function isPreviewableImagePath(filePath: string): boolean {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  return PREVIEWABLE_IMAGE_EXTENSIONS.has(ext)
}

export function WorktreeDiffPane(props: WorktreeDiffPaneProps) {
  const { t } = useI18n()
  const {
    diffSnapshot = null,
    latestRequestCollapse = null,
    onRefreshDiff,
    onRequestPatch,
  onRequestPreview,
    isRefreshingDiff = false,
    showHeader = true,
  } = props
  const files = diffSnapshot?.files ?? []
  const threadScopeKey = props.activeThreadId ?? ''
  const cwdKey = diffSnapshot?.cwd ?? ''
  const filePathsKey = files.map((file) => file.path).join('\0')
  const expansionScopeKey = `${threadScopeKey}\0${cwdKey}`
  const snapshotKey = `${threadScopeKey}\0${cwdKey}\0${diffSnapshot?.generatedAt ?? ''}`
  const fileSetKey = `${threadScopeKey}\0${cwdKey}\0${filePathsKey}`
  const [listOpen, setListOpen] = useState(true)
  const [patchByPath, setPatchByPath] = useState<Record<string, DiffFilePatchPayload>>({})
  const [patchLoadingByPath, setPatchLoadingByPath] = useState<Record<string, boolean>>({})
  const [patchErrorByPath, setPatchErrorByPath] = useState<Record<string, PatchErrorKind>>({})
  const [previewByPath, setPreviewByPath] = useState<Record<string, ImagePreviewState>>({})
  const [diffViewMode, setDiffViewMode] = useState<DiffRenderStyle>('unified')
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set())
  const [workerPoolEnabled, setWorkerPoolEnabled] = useState(false)
  const [workerPoolReady, setWorkerPoolReady] = useState(false)
  const snapshotKeyRef = useRef<string>(snapshotKey)
  const expansionScopeKeyRef = useRef<string>('')
  const requestedPatchPathsRef = useRef<Set<string>>(new Set())
  const pendingFirstTogglePathRef = useRef<string | null>(null)
  const pendingScopeEffectHasRunRef = useRef(false)
  const exceedsRenderFileLimit = files.length > MAX_RENDERABLE_DIFF_FILES
  const isLargeChangeSet = Boolean(diffSnapshot && diffSnapshot.hasChanges && exceedsRenderFileLimit)
  const hasTruncatedPreview = Boolean(diffSnapshot?.truncated)
  const hasTruncatedButNoFiles = Boolean(diffSnapshot?.hasChanges && diffSnapshot?.truncated && files.length === 0)
  const collapsePhaseLabel =
    latestRequestCollapse?.phase === 'reactive_retry'
      ? t('appShell.collapsePhase.reactiveRetry')
      : t('appShell.collapsePhase.initial')

  useEffect(() => {
    snapshotKeyRef.current = snapshotKey
    setPatchByPath({})
    setPatchLoadingByPath({})
    setPatchErrorByPath({})
    setPreviewByPath({})
    requestedPatchPathsRef.current.clear()
  }, [fileSetKey, snapshotKey])

  useEffect(() => {
    const previousExpansionScopeKey = expansionScopeKeyRef.current
    expansionScopeKeyRef.current = expansionScopeKey

    setExpandedPaths((prev) => {
      if (prev.size === 0) return prev
      if (previousExpansionScopeKey !== expansionScopeKey) return new Set()

      const currentFilePaths = new Set(filePathsKey ? filePathsKey.split('\0') : [])
      let changed = false
      const next = new Set<string>()
      for (const filePath of prev) {
        if (currentFilePaths.has(filePath)) {
          next.add(filePath)
          continue
        }
        changed = true
      }
      return changed ? next : prev
    })
  }, [expansionScopeKey, filePathsKey])

  const canPreviewImage = useCallback((filePath: string) => {
    return Boolean(onRequestPreview) && isPreviewableImagePath(filePath)
  }, [onRequestPreview])

  useEffect(() => {
    snapshotKeyRef.current = snapshotKey
    setPatchByPath({})
    setPatchLoadingByPath({})
    setPatchErrorByPath({})
    setPreviewByPath({})
    requestedPatchPathsRef.current.clear()
  }, [fileSetKey, snapshotKey])

  useEffect(() => {
    const previousExpansionScopeKey = expansionScopeKeyRef.current
    expansionScopeKeyRef.current = expansionScopeKey

    setExpandedPaths((prev) => {
      if (prev.size === 0) return prev
      if (previousExpansionScopeKey !== expansionScopeKey) return new Set()

      const currentFilePaths = new Set(filePathsKey ? filePathsKey.split('\0') : [])
      let changed = false
      const next = new Set<string>()
      for (const filePath of prev) {
        if (currentFilePaths.has(filePath)) {
          next.add(filePath)
          continue
        }
        changed = true
      }
      return changed ? next : prev
    })
  }, [expansionScopeKey, filePathsKey])

  const requestPatch = useCallback(async (filePath: string) => {
    if (!onRequestPatch) return
    if (requestedPatchPathsRef.current.has(filePath)) return
    requestedPatchPathsRef.current.add(filePath)

    const requestSnapshotKey = snapshotKeyRef.current
    let allowRetry = false
    setPatchLoadingByPath((prev) => ({ ...prev, [filePath]: true }))
    setPatchErrorByPath((prev) => {
      if (!prev[filePath]) return prev
      const next = { ...prev }
      delete next[filePath]
      return next
    })

    try {
      const payload = await onRequestPatch(filePath)
      if (snapshotKeyRef.current !== requestSnapshotKey) return
      if (!payload || !payload.found || !payload.patch) {
        allowRetry = true
        setPatchErrorByPath((prev) => ({ ...prev, [filePath]: 'unavailable' }))
        return
      }
      setPatchByPath((prev) => ({ ...prev, [filePath]: payload }))
    } catch {
      if (snapshotKeyRef.current !== requestSnapshotKey) return
      allowRetry = true
      setPatchErrorByPath((prev) => ({ ...prev, [filePath]: 'load_failed' }))
    } finally {
      if (snapshotKeyRef.current === requestSnapshotKey && allowRetry) {
        requestedPatchPathsRef.current.delete(filePath)
      }
      setPatchLoadingByPath((prev) => {
        if (snapshotKeyRef.current !== requestSnapshotKey) return prev
        if (!prev[filePath]) return prev
        const next = { ...prev }
        delete next[filePath]
        return next
      })
    }
  }, [onRequestPatch])

  const requestPreview = useCallback(async (filePath: string) => {
    if (!onRequestPreview || !canPreviewImage(filePath)) return
    const requestSnapshotKey = snapshotKeyRef.current
    const requestKey = `${requestSnapshotKey}\0${filePath}`
    const current = previewByPath[filePath]
    if (current?.status === 'ready' && current.requestKey === requestKey) return
    if (current?.status === 'loading' && current.requestKey === requestKey) return
    setPreviewByPath((prev) => ({ ...prev, [filePath]: { status: 'loading', requestKey } }))

    try {
      const payload = await onRequestPreview(filePath)
      if (snapshotKeyRef.current !== requestSnapshotKey) return
      const preview = payload?.preview
      if (!payload?.found || !preview?.dataUrl) {
        setPreviewByPath((prev) => ({ ...prev, [filePath]: { status: 'error', requestKey, error: 'unavailable' } }))
        return
      }
      setPreviewByPath((prev) => ({ ...prev, [filePath]: { status: 'ready', requestKey, preview } }))
    } catch {
      if (snapshotKeyRef.current !== requestSnapshotKey) return
      setPreviewByPath((prev) => ({ ...prev, [filePath]: { status: 'error', requestKey, error: 'load_failed' } }))
    }
  }, [canPreviewImage, onRequestPreview, previewByPath])

  const requestPatchIfNeeded = useCallback((file: DiffFile) => {
    if (canPreviewImage(file.path)) return
    if (!file.patch && !patchByPath[file.path] && !patchLoadingByPath[file.path]) {
      void requestPatch(file.path)
    }
  }, [canPreviewImage, patchByPath, patchLoadingByPath, requestPatch])

  const requestPreviewIfNeeded = useCallback((file: DiffFile) => {
    if (!canPreviewImage(file.path)) return
    const previewState = previewByPath[file.path]
    if (previewState?.status === 'ready' || previewState?.status === 'loading') return
    void requestPreview(file.path)
  }, [canPreviewImage, previewByPath, requestPreview])

  const applyFileToggle = useCallback((file: DiffFile, options?: { requestPatch?: boolean }) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev)
      if (next.has(file.path)) {
        next.delete(file.path)
        return next
      }

      next.add(file.path)
      if (canPreviewImage(file.path)) {
        requestPreviewIfNeeded(file)
      } else if (options?.requestPatch !== false) {
        requestPatchIfNeeded(file)
      }
      return next
    })
  }, [canPreviewImage, requestPatchIfNeeded, requestPreviewIfNeeded])

  const clearPendingFirstToggle = useCallback(() => {
    pendingFirstTogglePathRef.current = null
  }, [])

  const toggleFile = useCallback((file: DiffFile) => {
    if (canPreviewImage(file.path)) {
      clearPendingFirstToggle()
      applyFileToggle(file)
      return
    }

    if (!workerPoolReady && typeof Worker === 'function') {
      setWorkerPoolEnabled(true)
      requestPatchIfNeeded(file)
      if (pendingFirstTogglePathRef.current === file.path) return
      pendingFirstTogglePathRef.current = file.path
      return
    }

    clearPendingFirstToggle()
    applyFileToggle(file)
  }, [applyFileToggle, canPreviewImage, clearPendingFirstToggle, requestPatchIfNeeded, workerPoolReady])

  const getPatchStatusMessage = useCallback((filePath: string) => {
    const patchError = patchErrorByPath[filePath]
    if (patchLoadingByPath[filePath]) return t('worktreeDiff.loadingPatch')
    if (patchError === 'load_failed') return t('worktreeDiff.patchLoadFailed')
    if (patchError === 'unavailable') return t('worktreeDiff.patchUnavailable')
    if (onRequestPatch && requestedPatchPathsRef.current.has(filePath)) return t('worktreeDiff.loadingPatch')
    return t('worktreeDiff.patchUnavailable')
  }, [onRequestPatch, patchErrorByPath, patchLoadingByPath, t])

  const markWorkerPoolReady = useCallback(() => {
    setWorkerPoolReady(true)
  }, [])

  useEffect(() => {
    if (!onRequestPatch || expandedPaths.size === 0) return
    for (const file of files) {
      if (!expandedPaths.has(file.path)) continue
      if (canPreviewImage(file.path)) continue
      if (file.patch || patchByPath[file.path] || patchLoadingByPath[file.path]) continue
      if (patchErrorByPath[file.path]) continue
      void requestPatch(file.path)
    }
  }, [canPreviewImage, expandedPaths, files, onRequestPatch, patchByPath, patchErrorByPath, patchLoadingByPath, requestPatch, snapshotKey])

  useEffect(() => {
    if (!onRequestPreview || expandedPaths.size === 0) return
    for (const file of files) {
      if (!expandedPaths.has(file.path)) continue
      if (!canPreviewImage(file.path)) continue
      const previewState = previewByPath[file.path]
      if (previewState?.status === 'loading' || previewState?.status === 'ready') continue
      void requestPreview(file.path)
    }
  }, [canPreviewImage, expandedPaths, files, onRequestPreview, previewByPath, requestPreview, snapshotKey])

  useEffect(() => clearPendingFirstToggle, [clearPendingFirstToggle])

  useEffect(() => {
    if (!pendingScopeEffectHasRunRef.current) {
      pendingScopeEffectHasRunRef.current = true
      return
    }
    clearPendingFirstToggle()
  }, [clearPendingFirstToggle, fileSetKey, listOpen, snapshotKey])

  useEffect(() => {
    if (!workerPoolReady || !listOpen) return
    const pendingPath = pendingFirstTogglePathRef.current
    if (!pendingPath) return
    pendingFirstTogglePathRef.current = null
    const pendingFile = files.find((file) => file.path === pendingPath)
    if (pendingFile) {
      applyFileToggle(pendingFile, { requestPatch: false })
    }
  }, [applyFileToggle, files, listOpen, workerPoolReady])

  return (
    <aside
      data-testid="worktree-diff-pane"
      className="h-full w-full min-w-0 flex flex-col overflow-hidden overflow-x-hidden bg-background selection:bg-primary/10"
    >
      {showHeader ? (
        <div className="flex-none flex items-center justify-between gap-3 px-6 h-14 bg-background z-[30]">
          <div className="flex min-w-0 flex-1 items-center gap-1.5 cursor-pointer select-none" onClick={() => setListOpen(!listOpen)}>
            <h2 className="min-w-0 truncate ui-text-base font-semibold ui-text-primary">{t('worktreeDiff.title')}</h2>
            <ChevronDown className={cn('size-3.5 ui-text-secondary transition-transform', !listOpen && '-rotate-90')} />
          </div>

          <div className="flex shrink-0 items-center gap-3">
            <div
              role="group"
              aria-label={t('worktreeDiff.viewMode')}
              className="inline-flex h-7 shrink-0 items-center rounded-md border border-border/70 bg-muted/35 p-0.5 font-mono text-[11px] leading-none"
            >
              {DIFF_VIEW_MODES.map((mode) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={diffViewMode === mode}
                  className={cn(
                    'h-6 whitespace-nowrap rounded-[5px] px-2.5 transition-colors',
                    diffViewMode === mode
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                  onClick={(event) => {
                    event.stopPropagation()
                    setDiffViewMode(mode)
                  }}
                >
                  {t(mode === 'unified' ? 'worktreeDiff.viewModeUnified' : 'worktreeDiff.viewModeSplit')}
                </button>
              ))}
            </div>

            <div className="flex shrink-0 items-center gap-2.5 ui-text-secondary">
              <span className="ui-text-meta ui-text-secondary">{t('worktreeDiff.changesCount', { count: files.length })}</span>
              <button
                type="button"
                aria-label={t('worktreeDiff.refresh')}
                className="inline-flex items-center justify-center rounded-md p-0.5"
                onClick={(e) => {
                  e.stopPropagation()
                  onRefreshDiff?.()
                }}
              >
                <RefreshCw
                  className={cn(
                    'size-3.5 hover:text-foreground transition-all cursor-pointer',
                    isRefreshingDiff && 'animate-spin',
                  )}
                />
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {latestRequestCollapse ? (
        <div
          data-testid="worktree-collapse-summary"
          className="mx-6 mb-3 flex-none rounded-[10px] border border-border/65 ui-surface-subtle px-3.5 py-3"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="ui-text-base font-medium ui-text-primary">
                {t('worktreeDiff.latestCollapseTitle')}
              </div>
              <div className="mt-1 ui-text-meta ui-text-secondary">
                {t('worktreeDiff.latestCollapseSummary', {
                  tokens: String(latestRequestCollapse.estimatedTokensSaved),
                  messages: String(latestRequestCollapse.collapsedHeadMessageCount),
                  phase: collapsePhaseLabel,
                })}
              </div>
            </div>
            {latestRequestCollapse.recapFingerprint ? (
              <div className="shrink-0 rounded-md border border-border/60 bg-background/70 px-2 py-1 font-mono text-[11px] text-muted-foreground">
                {latestRequestCollapse.recapFingerprint.slice(0, 12)}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {listOpen ? (
        !diffSnapshot ? null : isLargeChangeSet ? (
          <div className="grid min-h-[55vh] place-items-center">
            <div className="text-center">
              <h3 className="mt-4 ui-text-base font-semibold tracking-tight ui-text-primary">{t('worktreeDiff.changeSetTooLargeTitle')}</h3>
              <p className="mt-2 ui-text-base text-muted-foreground">{t('worktreeDiff.changeSetTooLargeBody')}</p>
            </div>
          </div>
        ) : files.length === 0 && !diffSnapshot.hasChanges ? (
          <div className="grid min-h-[55vh] place-items-center">
            <div className="text-center">
              <div className="text-[30px] leading-none">🧹</div>
              <h3 className="mt-4 ui-text-base font-semibold tracking-tight ui-text-primary">{t('worktreeDiff.emptyTitle')}</h3>
              <p className="mt-2 ui-text-base text-muted-foreground">{t('worktreeDiff.emptyBody')}</p>
            </div>
          </div>
        ) : hasTruncatedButNoFiles ? (
          <div className="grid min-h-[55vh] place-items-center">
            <div className="text-center">
              <h3 className="mt-4 ui-text-base font-semibold tracking-tight ui-text-primary">{t('worktreeDiff.largeDiffTitle')}</h3>
              <p className="mt-2 ui-text-base text-muted-foreground">{t('worktreeDiff.previewUnavailable')}</p>
            </div>
          </div>
        ) : (
          <DiffWorkerPoolBoundary enabled={workerPoolEnabled} onReady={markWorkerPoolReady}>
            {hasTruncatedPreview ? (
              <div className="mx-6 flex-none rounded-[10px] border border-border/65 ui-surface-subtle px-3.5 py-2">
                <div className="ui-text-meta ui-text-secondary">{t('worktreeDiff.partialPreview')}</div>
              </div>
            ) : null}
            <div
              data-testid="worktree-diff-card-list"
              className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-6 pb-4 pt-2 [overflow-anchor:none]"
            >
              <div className="flex min-w-0 flex-col gap-2">
                <CodexFileTreeIconSprite />
                {files.map((file) => {
                  const loadedPatch = patchByPath[file.path]
                  const patch = file.patch ?? loadedPatch?.patch ?? ''
                  const expanded = expandedPaths.has(file.path)
                  const additions = loadedPatch?.additions ?? file.additions
                  const deletions = loadedPatch?.deletions ?? file.deletions
                  const truncated = loadedPatch?.truncated
                  const isImagePreview = canPreviewImage(file.path)
                  const body = isImagePreview ? (
                    <ImagePreviewBody
                      path={file.path}
                      state={previewByPath[file.path] ?? { status: 'idle' }}
                      loadingLabel={t('worktreeDiff.loadingImagePreview')}
                      unavailableLabel={t('worktreeDiff.imagePreviewUnavailable')}
                      deletedLabel={t('worktreeDiff.imagePreviewDeleted')}
                      alt={t('worktreeDiff.imagePreviewAlt')}
                    />
                  ) : patch ? (
                    <DiffPatchView
                      path={file.path}
                      patch={patch}
                      additions={additions}
                      deletions={deletions}
                      truncated={truncated}
                      diffStyle={diffViewMode}
                      showFileHeader={false}
                    />
                  ) : (
                    <div
                      data-testid="worktree-diff-file-status"
                      className="rounded-b-[10px] border-x border-b border-border/70 bg-muted/25 px-4 py-3 ui-text-meta text-muted-foreground"
                    >
                      {getPatchStatusMessage(file.path)}
                    </div>
                  )

                  return (
                    <DiffFileCard
                      key={file.path}
                      file={file}
                      expanded={expanded}
                      additions={additions}
                      deletions={deletions}
                      toggleLabel={t('worktreeDiff.toggleFile')}
                      onToggle={() => toggleFile(file)}
                    >
                      {body}
                    </DiffFileCard>
                  )
                })}
              </div>
            </div>
          </DiffWorkerPoolBoundary>
        )
      ) : null}
    </aside>
  )
}

function DiffWorkerPoolBoundary(props: { enabled: boolean; onReady: () => void; children: ReactNode }) {
  const [moduleState, setModuleState] = useState<DiffWorkerPoolModuleState | null>(null)

  useEffect(() => {
    if (!props.enabled || moduleState) return
    let cancelled = false
    void Promise.all([
      import('@pierre/diffs/react'),
      import('@pierre/diffs/worker/worker.js?url'),
    ]).then(([reactModule, workerModule]) => {
      if (cancelled) return
      setModuleState({
        status: 'ready',
        Provider: reactModule.WorkerPoolContextProvider,
        poolOptions: {
          poolSize: 2,
          workerFactory: () => new Worker(workerModule.default, { type: 'module' }),
        },
      })
    }).catch(() => {
      if (cancelled) return
      setModuleState({ status: 'failed' })
    })
    return () => {
      cancelled = true
    }
  }, [moduleState, props.enabled])

  useEffect(() => {
    if (!moduleState) return
    if (moduleState.status === 'failed') {
      props.onReady()
      return
    }
    const handle = window.setTimeout(() => {
      props.onReady()
    }, DIFF_WORKER_POOL_PROVIDER_SETTLE_MS)
    return () => {
      window.clearTimeout(handle)
    }
  }, [moduleState, props.onReady])

  if (!props.enabled || !moduleState || moduleState.status === 'failed') return <>{props.children}</>
  const Provider = moduleState.Provider
  return (
    <Provider poolOptions={moduleState.poolOptions} highlighterOptions={{}}>
      {props.children}
    </Provider>
  )
}

function DiffFileCard(props: {
  file: DiffFile
  expanded: boolean
  additions: number
  deletions: number
  toggleLabel: string
  onToggle: () => void
  children: ReactNode
}) {
  const { className: fileIconClassName, token: fileIconToken } = getFileIconMeta(props.file.path)

  return (
    <section
      data-testid="worktree-diff-file-card"
      data-review-path={props.file.path}
      data-expanded={props.expanded ? 'true' : 'false'}
      className="group/file-diff min-w-0 overflow-clip rounded-[10px] bg-background"
    >
      <div
        role="button"
        tabIndex={0}
        className="sticky top-0 z-10 cursor-pointer select-none bg-background"
        onClick={props.onToggle}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault()
          props.onToggle()
        }}
      >
        <div className="px-2 py-[2px]">
          <div className="group/diff-header @container/diff-header relative flex min-h-9 items-center gap-2 rounded-[6px] px-0.5 py-0.5 hover:bg-muted/50">
            <button
              type="button"
              data-testid="worktree-diff-file-toggle"
              data-app-action-review-file-toggle=""
              data-app-action-review-file-expanded={props.expanded ? 'true' : 'false'}
              aria-label={props.toggleLabel}
              aria-expanded={props.expanded}
              className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg bg-transparent text-foreground transition-colors hover:bg-muted"
              onKeyDown={(event) => {
                event.stopPropagation()
              }}
              onClick={(event) => {
                event.stopPropagation()
                props.onToggle()
              }}
            >
              <ChevronDown
                className={cn(
                  'size-4 transition-transform duration-200',
                  props.expanded ? 'rotate-180' : 'rotate-0',
                )}
              />
            </button>
            <div className="flex min-w-0 flex-1 items-center gap-2 ui-text-base ui-text-primary">
              <span
                aria-hidden="true"
                data-file-icon-token={fileIconToken}
                className={cn('inline-flex size-4 shrink-0 items-center justify-center', fileIconClassName)}
              >
                <svg aria-hidden="true" className="size-4 shrink-0" viewBox="0 0 16 16">
                  <use href={`#file-tree-builtin-${fileIconToken}`} />
                </svg>
              </span>
              <span
                className="min-w-0 truncate font-mono text-[13px] [direction:rtl]"
                title={props.file.path}
              >
                <span className="min-w-0 truncate [direction:ltr] [unicode-bidi:plaintext]">
                  {props.file.path}
                </span>
              </span>
              {props.file.untracked ? (
                <span data-testid="worktree-diff-untracked-indicator" className="mb-0.5 text-primary">
                  <span className="inline-block size-1.5 rounded-full bg-current" />
                </span>
              ) : null}
            </div>
            <div className="ms-auto flex shrink-0 items-center gap-1 font-mono text-[13px] tabular-nums tracking-normal">
              <span className="ui-text-diff-add">+{props.additions}</span>
              <span className="ui-text-diff-del">-{props.deletions}</span>
            </div>
          </div>
        </div>
      </div>
      {props.expanded ? (
        <div data-testid="worktree-diff-file-body" className="min-w-0">
          {props.children}
        </div>
      ) : null}
    </section>
  )
}

function ImagePreviewBody(props: {
  path: string
  state: ImagePreviewState
  loadingLabel: string
  unavailableLabel: string
  deletedLabel: string
  alt: string
}) {
  if (props.state.status === 'ready') {
    const isDeleted = props.state.preview.changeKind === 'deleted'
    return (
      <div
        data-testid="worktree-diff-image-preview"
        data-change-kind={props.state.preview.changeKind ?? 'modified'}
        className={cn(
          'min-w-0 bg-background px-4 py-5',
          isDeleted && 'grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(160px,0.42fr)] md:items-stretch',
        )}
      >
        <div className="min-w-0">
          <div className="flex min-h-28 items-center justify-center overflow-auto rounded-md bg-muted/20 p-3">
            <img
              src={props.state.preview.dataUrl}
              alt={props.alt}
              title={props.path}
              className="max-h-[420px] max-w-full rounded-sm object-contain shadow-sm"
            />
          </div>
          <div className="mt-2 text-center ui-text-meta text-muted-foreground">
            {props.state.preview.mimeType} · {formatBytes(props.state.preview.sizeBytes)}
          </div>
        </div>
        {isDeleted ? (
          <div
            data-testid="worktree-diff-image-preview-deleted"
            className="flex min-h-28 items-center justify-center rounded-md bg-muted/15 px-4 py-5 text-center"
          >
            <div className="ui-text-base font-medium text-muted-foreground">{props.deletedLabel}</div>
          </div>
        ) : null}
      </div>
    )
  }

  if (props.state.status === 'error') {
    return (
      <div
        data-testid="worktree-diff-image-preview-error"
        data-error={props.state.error}
        className="bg-muted/20 px-4 py-3 ui-text-meta text-muted-foreground"
      >
        {props.unavailableLabel}
      </div>
    )
  }

  return (
    <div
      data-testid="worktree-diff-image-preview-loading"
      className="flex min-h-24 items-center justify-center bg-muted/20 px-4 py-4 ui-text-meta text-muted-foreground"
    >
      {props.loadingLabel}
    </div>
  )
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  const kib = bytes / 1024
  if (kib < 1024) return `${kib.toFixed(kib >= 10 ? 0 : 1)} KB`
  const mib = kib / 1024
  return `${mib.toFixed(mib >= 10 ? 0 : 1)} MB`
}
