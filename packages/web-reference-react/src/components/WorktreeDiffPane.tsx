import {
  AlignJustify,
  Check,
  ChevronDown,
  Clipboard,
  EyeOff,
  FileText,
  GitBranch,
  GitCommitHorizontal,
  Image,
  MoreHorizontal,
  Pilcrow,
  RefreshCw,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { WorkerPoolOptions } from '@pierre/diffs/react'
import { useI18n } from '../app/i18n/I18nProvider'
import type { RequestCollapseSummary } from '../types'
import { cn } from '../lib/utils'
import { CodexFileTreeIconSprite } from './diff/CodexFileTreeIconSprite'
import { DiffFileCard } from './diff/DiffFileCard'
import type { DiffRenderStyle } from './diff/DiffPatchView'
import { WorktreeDiffFileBody } from './diff/WorktreeDiffFileBody'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from './ui/dropdown-menu'
import {
  type DiffFilePatchPayload,
  type DiffFilePreviewPayload,
  type DiffFileViewModel,
  type DiffSnapshot,
  type ImagePreviewState,
  type PatchErrorKind,
  type ReviewGitSource,
  type ReviewGitSourceKey,
} from './diff/diffTypes'

type DiffFile = DiffFileViewModel
export type { DiffFilePatchPayload, DiffFilePreviewPayload, DiffSnapshot } from './diff/diffTypes'

export type WorktreeDiffPaneProps = {
  activeThreadId?: string | null
  diffSnapshot?: DiffSnapshot | null
  latestRequestCollapse?: RequestCollapseSummary | null
  onRefreshDiff?: (source?: ReviewGitSource | null) => void
  onRequestPatch?: (filePath: string, source?: ReviewGitSource | null) => Promise<DiffFilePatchPayload | null>
  onRequestPreview?: (filePath: string, source?: ReviewGitSource | null) => Promise<DiffFilePreviewPayload | null>
  isRefreshingDiff?: boolean
  showHeader?: boolean
}

const MAX_RENDERABLE_DIFF_FILES = 120
const DIFF_WORKER_POOL_PROVIDER_SETTLE_MS = 50
const PREVIEWABLE_IMAGE_EXTENSIONS = new Set(['avif', 'bmp', 'gif', 'ico', 'jpeg', 'jpg', 'png', 'webp'])
const DEFAULT_REVIEW_SOURCE: ReviewGitSource = { kind: 'unstaged' }
type DiffWorkerPoolModuleState = {
  status: 'ready'
  Provider: typeof import('@pierre/diffs/react').WorkerPoolContextProvider
  poolOptions: WorkerPoolOptions
} | { status: 'failed' }

type FileDisplayParts = {
  dir: string
  name: string
}

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

function getFileDisplayParts(path: string): FileDisplayParts {
  const lastSlashIndex = path.lastIndexOf('/')
  if (lastSlashIndex < 0) return { dir: '', name: path }
  return {
    dir: path.slice(0, lastSlashIndex + 1),
    name: path.slice(lastSlashIndex + 1),
  }
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

function getReviewSourceKey(source: ReviewGitSource): ReviewGitSourceKey {
  return `git:${source.kind}`
}

function getSnapshotSourceKey(snapshot: DiffSnapshot | null): ReviewGitSourceKey {
  return snapshot?.sourceKey ?? getReviewSourceKey(snapshot?.source ?? DEFAULT_REVIEW_SOURCE)
}

function SourceCountBadge(props: { count: number | undefined }) {
  if (typeof props.count !== 'number') return null
  return (
    <span className="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
      {props.count}
    </span>
  )
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
  const [activeReviewSource, setActiveReviewSource] = useState<ReviewGitSource>(diffSnapshot?.source ?? DEFAULT_REVIEW_SOURCE)
  const [sourceFileCountByScopedKey, setSourceFileCountByScopedKey] = useState<Record<string, number>>({})
  const activeReviewSourceKey = getReviewSourceKey(activeReviewSource)
  const snapshotSourceKey = getSnapshotSourceKey(diffSnapshot)
  const activeDiffSnapshot = snapshotSourceKey === activeReviewSourceKey ? diffSnapshot : null
  const files = activeDiffSnapshot?.files ?? []
  const sourceCountScopeKey = `${props.activeThreadId ?? ''}\0${diffSnapshot?.cwd ?? ''}`
  const getSourceCountScopedKey = (sourceKey: ReviewGitSourceKey) => `${sourceCountScopeKey}\0${sourceKey}`
  const activeSourceCount =
    sourceFileCountByScopedKey[getSourceCountScopedKey(activeReviewSourceKey)] ?? activeDiffSnapshot?.files.length
  const unstagedSourceCount = sourceFileCountByScopedKey[getSourceCountScopedKey('git:unstaged')]
  const stagedSourceCount = sourceFileCountByScopedKey[getSourceCountScopedKey('git:staged')]
  const displayedUnstagedSourceCount =
    activeReviewSource.kind === 'unstaged' ? unstagedSourceCount ?? activeSourceCount : unstagedSourceCount
  const displayedStagedSourceCount =
    activeReviewSource.kind === 'staged' ? stagedSourceCount ?? activeSourceCount : stagedSourceCount
  const threadScopeKey = props.activeThreadId ?? ''
  const cwdKey = activeDiffSnapshot?.cwd ?? diffSnapshot?.cwd ?? ''
  const filePathsKey = files.map((file) => file.path).join('\0')
  const expansionScopeKey = `${threadScopeKey}\0${cwdKey}\0${activeReviewSourceKey}`
  const snapshotKey = `${threadScopeKey}\0${cwdKey}\0${activeReviewSourceKey}\0${activeDiffSnapshot?.generatedAt ?? ''}`
  const fileSetKey = `${threadScopeKey}\0${cwdKey}\0${activeReviewSourceKey}\0${filePathsKey}`
  const [patchByPath, setPatchByPath] = useState<Record<string, DiffFilePatchPayload>>({})
  const [patchLoadingByPath, setPatchLoadingByPath] = useState<Record<string, boolean>>({})
  const [patchErrorByPath, setPatchErrorByPath] = useState<Record<string, PatchErrorKind>>({})
  const [previewByPath, setPreviewByPath] = useState<Record<string, ImagePreviewState>>({})
  const [diffViewMode, setDiffViewMode] = useState<DiffRenderStyle>('unified')
  const [wrapDiffLines, setWrapDiffLines] = useState(false)
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set())
  const [workerPoolEnabled, setWorkerPoolEnabled] = useState(false)
  const [workerPoolReady, setWorkerPoolReady] = useState(false)
  const snapshotKeyRef = useRef<string>(snapshotKey)
  const expansionScopeKeyRef = useRef<string>('')
  const requestedPatchPathsRef = useRef<Set<string>>(new Set())
  const pendingFirstTogglePathRef = useRef<string | null>(null)
  const pendingScopeEffectHasRunRef = useRef(false)
  const exceedsRenderFileLimit = files.length > MAX_RENDERABLE_DIFF_FILES
  const isLargeChangeSet = Boolean(activeDiffSnapshot && activeDiffSnapshot.hasChanges && exceedsRenderFileLimit)
  const hasTruncatedPreview = Boolean(activeDiffSnapshot?.truncated)
  const hasTruncatedButNoFiles = Boolean(activeDiffSnapshot?.hasChanges && activeDiffSnapshot?.truncated && files.length === 0)
  const totalAdditions = files.reduce((sum, file) => sum + file.additions, 0)
  const totalDeletions = files.reduce((sum, file) => sum + file.deletions, 0)
  const hasExpandableFiles = files.length > 0 && !isLargeChangeSet && !hasTruncatedButNoFiles
  const allFilesExpanded = hasExpandableFiles && files.every((file) => expandedPaths.has(file.path))
  const expandCollapseAllLabel = allFilesExpanded ? t('worktreeDiff.collapseAll') : t('worktreeDiff.expandAll')
  const nextDiffViewMode: DiffRenderStyle = diffViewMode === 'unified' ? 'split' : 'unified'
  const nextDiffViewModeLabel = t(
    nextDiffViewMode === 'unified' ? 'worktreeDiff.switchToUnified' : 'worktreeDiff.switchToSplit',
  )
  const canRefreshDiff = Boolean(onRefreshDiff) && !isRefreshingDiff
  const collapsePhaseLabel =
    latestRequestCollapse?.phase === 'reactive_retry'
      ? t('appShell.collapsePhase.reactiveRetry')
      : t('appShell.collapsePhase.initial')
  const canPreviewImage = useCallback((filePath: string) => {
    return Boolean(onRequestPreview) && isPreviewableImagePath(filePath)
  }, [onRequestPreview])

  useEffect(() => {
    if (diffSnapshot?.source) {
      setActiveReviewSource(diffSnapshot.source)
    }
  }, [diffSnapshot?.sourceKey])

  useEffect(() => {
    if (!diffSnapshot) return
    const sourceKey = getSnapshotSourceKey(diffSnapshot)
    const scopedKey = getSourceCountScopedKey(sourceKey)
    setSourceFileCountByScopedKey((prev) => {
      if (prev[scopedKey] === diffSnapshot.files.length) return prev
      return { ...prev, [scopedKey]: diffSnapshot.files.length }
    })
  }, [diffSnapshot])

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
      const payload = await onRequestPatch(filePath, activeReviewSource)
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
  }, [activeReviewSource, onRequestPatch])

  const requestPreview = useCallback(async (filePath: string) => {
    if (!onRequestPreview || !canPreviewImage(filePath)) return
    const requestSnapshotKey = snapshotKeyRef.current
    const requestKey = `${requestSnapshotKey}\0${filePath}`
    const current = previewByPath[filePath]
    if (current?.status === 'ready' && current.requestKey === requestKey) return
    if (current?.status === 'loading' && current.requestKey === requestKey) return
    setPreviewByPath((prev) => ({ ...prev, [filePath]: { status: 'loading', requestKey } }))

    try {
      const payload = await onRequestPreview(filePath, activeReviewSource)
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
  }, [activeReviewSource, canPreviewImage, onRequestPreview, previewByPath])

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

  const toggleAllFiles = useCallback(() => {
    if (!hasExpandableFiles) return
    clearPendingFirstToggle()
    if (allFilesExpanded) {
      setExpandedPaths(new Set())
      return
    }

    if (typeof Worker === 'function') {
      setWorkerPoolEnabled(true)
    }
    for (const file of files) {
      if (canPreviewImage(file.path)) {
        requestPreviewIfNeeded(file)
      } else {
        requestPatchIfNeeded(file)
      }
    }
    setExpandedPaths(new Set(files.map((file) => file.path)))
  }, [
    allFilesExpanded,
    canPreviewImage,
    clearPendingFirstToggle,
    files,
    hasExpandableFiles,
    requestPatchIfNeeded,
    requestPreviewIfNeeded,
  ])

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

  const selectReviewSource = useCallback((source: ReviewGitSource) => {
    const nextSourceKey = getReviewSourceKey(source)
    if (nextSourceKey === activeReviewSourceKey) return
    setActiveReviewSource(source)
    setExpandedPaths(new Set())
    onRefreshDiff?.(source)
  }, [activeReviewSourceKey, onRefreshDiff])

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
      if (previewState?.status === 'ready' || previewState?.status === 'loading' || previewState?.status === 'error') continue
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
  }, [clearPendingFirstToggle, fileSetKey, snapshotKey])

  useEffect(() => {
    if (!workerPoolReady) return
    const pendingPath = pendingFirstTogglePathRef.current
    if (!pendingPath) return
    pendingFirstTogglePathRef.current = null
    const pendingFile = files.find((file) => file.path === pendingPath)
    if (pendingFile) {
      applyFileToggle(pendingFile, { requestPatch: false })
    }
  }, [applyFileToggle, files, workerPoolReady])

  const collapseSummary = latestRequestCollapse ? (
    <div
      data-testid="worktree-collapse-summary"
      className="mx-3 mb-2 mt-2 flex-none rounded-[10px] border border-border/65 ui-surface-subtle px-3.5 py-3"
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
  ) : null
  const imagePreviewLabels = {
    loading: t('worktreeDiff.loadingImagePreview'),
    unavailable: t('worktreeDiff.imagePreviewUnavailable'),
    deleted: t('worktreeDiff.imagePreviewDeleted'),
    alt: t('worktreeDiff.imagePreviewAlt'),
  }

  return (
    <aside
      data-testid="worktree-diff-pane"
      className="relative grid h-full min-h-0 w-full min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-background selection:bg-primary/10"
    >
      {showHeader ? (
        <div className="grid h-[var(--review-toolbar-height)] grid-cols-[minmax(0,1fr)_auto] items-center gap-1 border-b border-border/70 px-2 text-muted-foreground [container-name:review-header] [container-type:inline-size]">
          <div className="flex w-full min-w-0 flex-col overflow-hidden text-size-chat">
            <div className="flex min-w-0 items-center gap-1 overflow-hidden">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="flex h-token-button-composer w-fit max-w-[320px] shrink-0 items-center gap-1.5 rounded-lg border border-transparent px-1.5 text-foreground transition-colors hover:bg-muted/55 data-[state=open]:bg-muted/55"
                  >
                    <span className="flex max-w-full min-w-0 items-center gap-1.5 truncate">
                      <span className="min-w-0 truncate font-semibold">
                        {t(activeReviewSource.kind === 'staged' ? 'worktreeDiff.sourceStaged' : 'worktreeDiff.sourceUnstaged')}
                      </span>
                      <SourceCountBadge count={activeSourceCount} />
                    </span>
                    <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" sideOffset={6} className="ui-menu-content w-[var(--composer-menu-width)] p-1">
                  <DropdownMenuItem
                    className="ui-composer-menu-item ui-text-base"
                    onSelect={() => selectReviewSource({ kind: 'unstaged' })}
                  >
                    <span className="flex flex-1 items-center gap-2">
                      <span>{t('worktreeDiff.sourceUnstaged')}</span>
                      <SourceCountBadge count={displayedUnstagedSourceCount} />
                    </span>
                    {activeReviewSource.kind === 'unstaged' ? (
                      <Check className="ml-1 h-4 w-4" />
                    ) : null}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="ui-composer-menu-item ui-text-base"
                    onSelect={() => selectReviewSource({ kind: 'staged' })}
                  >
                    <span className="flex flex-1 items-center gap-2">
                      <span>{t('worktreeDiff.sourceStaged')}</span>
                      <SourceCountBadge count={displayedStagedSourceCount} />
                    </span>
                    {activeReviewSource.kind === 'staged' ? (
                      <Check className="ml-1 h-4 w-4" />
                    ) : null}
                  </DropdownMenuItem>
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger disabled className="ui-composer-menu-item ui-text-base">
                      <GitCommitHorizontal className="size-4" />
                      <span className="flex-1">{t('worktreeDiff.sourceCommit')}</span>
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="ui-menu-content w-[260px] p-1">
                      <DropdownMenuItem disabled className="ui-composer-menu-item ui-text-base">
                        {t('worktreeDiff.sourceCommitPlaceholder')}
                      </DropdownMenuItem>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                  <DropdownMenuItem disabled className="ui-composer-menu-item ui-text-base">
                    <GitBranch className="size-4" />
                    <span className="flex-1">{t('worktreeDiff.sourceBranch')}</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled className="ui-composer-menu-item ui-text-base">
                    <span className="flex-1">{t('worktreeDiff.sourcePreviousConversation')}</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <span className="mr-1 inline-flex shrink-0 select-none items-center gap-1 font-mono text-size-chat tabular-nums tracking-tight">
                <span className="flex shrink-0 items-center ui-text-diff-add">+{totalAdditions}</span>
                <span className="flex shrink-0 items-center ui-text-diff-del">-{totalDeletions}</span>
              </span>
            </div>
          </div>

          <div className="flex min-w-0 shrink-0 items-center gap-1.5">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={t('worktreeDiff.moreMenu')}
                  className="inline-flex h-token-button-composer aspect-square items-center justify-center rounded-lg border border-transparent text-muted-foreground transition-colors hover:bg-muted/55 hover:text-foreground data-[state=open]:bg-muted/55 data-[state=open]:text-foreground"
                  onClick={(event) => {
                    event.stopPropagation()
                  }}
                >
                  <MoreHorizontal className="size-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" sideOffset={6} className="ui-menu-content w-[280px] p-1">
                <DropdownMenuItem
                  disabled={!canRefreshDiff}
                  className="ui-composer-menu-item ui-text-base"
                  onSelect={() => {
                    if (canRefreshDiff) onRefreshDiff?.(activeReviewSource)
                  }}
                >
                  <RefreshCw className={cn('size-4', isRefreshingDiff && 'animate-spin')} />
                  <span className="flex-1">{t('worktreeDiff.refresh')}</span>
                </DropdownMenuItem>
                <DropdownMenuCheckboxItem
                  checked={wrapDiffLines}
                  className="ui-composer-menu-item ui-text-base pl-2 pr-8 [&_[data-slot=dropdown-menu-checkbox-indicator]]:left-auto [&_[data-slot=dropdown-menu-checkbox-indicator]]:right-2"
                  onCheckedChange={(checked) => {
                    setWrapDiffLines(Boolean(checked))
                  }}
                >
                  <AlignJustify className="size-4" />
                  <span className="flex-1">{t('worktreeDiff.enableAutoWrap')}</span>
                </DropdownMenuCheckboxItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled className="ui-composer-menu-item ui-text-base">
                  <FileText className="size-4" />
                  <span className="flex-1">{t('worktreeDiff.disableFullFileLoad')}</span>
                </DropdownMenuItem>
                <DropdownMenuItem disabled className="ui-composer-menu-item ui-text-base">
                  <Image className="size-4" />
                  <span className="flex-1">{t('worktreeDiff.enableRichPreview')}</span>
                </DropdownMenuItem>
                <DropdownMenuItem disabled className="ui-composer-menu-item ui-text-base">
                  <Pilcrow className="size-4" />
                  <span className="flex-1">{t('worktreeDiff.enableWordDiff')}</span>
                </DropdownMenuItem>
                <DropdownMenuItem disabled className="ui-composer-menu-item ui-text-base">
                  <EyeOff className="size-4" />
                  <span className="flex-1">{t('worktreeDiff.hideWhitespace')}</span>
                </DropdownMenuItem>
                <DropdownMenuItem disabled className="ui-composer-menu-item ui-text-base">
                  <Clipboard className="size-4" />
                  <span className="flex-1">{t('worktreeDiff.copyGitApplyCommand')}</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <button
              type="button"
              aria-label={expandCollapseAllLabel}
              aria-pressed={allFilesExpanded}
              disabled={!hasExpandableFiles}
              className="inline-flex h-token-button-composer aspect-square items-center justify-center rounded-lg border border-transparent text-muted-foreground transition-colors hover:bg-muted/55 hover:text-foreground disabled:pointer-events-none disabled:opacity-45"
              onClick={(event) => {
                event.stopPropagation()
                toggleAllFiles()
              }}
            >
              <ReviewExpandToggleIcon expanded={allFilesExpanded} />
            </button>

            <button
              type="button"
              aria-label={nextDiffViewModeLabel}
              aria-pressed={diffViewMode === 'split'}
              className="inline-flex h-token-button-composer aspect-square items-center justify-center rounded-lg border border-transparent text-muted-foreground transition-colors hover:bg-muted/55 hover:text-foreground"
              onClick={(event) => {
                event.stopPropagation()
                setDiffViewMode(nextDiffViewMode)
              }}
            >
              <ReviewViewModeIcon mode={diffViewMode} />
            </button>

            <span className="hidden shrink-0 ui-text-meta ui-text-secondary @container_review-header_(min-width:720px):inline">
              {t('worktreeDiff.changesCount', { count: files.length })}
            </span>
          </div>
        </div>
      ) : null}

      <div className="flex min-h-0 max-w-full min-w-0">
        <div className="relative flex h-full min-w-0 flex-1">
          {!activeDiffSnapshot ? null : isLargeChangeSet ? (
            <div className="flex h-full min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto">
              {collapseSummary}
              <div className="grid min-h-[55vh] flex-1 place-items-center">
                <div className="text-center">
                  <h3 className="mt-4 ui-text-base font-semibold tracking-tight ui-text-primary">{t('worktreeDiff.changeSetTooLargeTitle')}</h3>
                  <p className="mt-2 ui-text-base text-muted-foreground">{t('worktreeDiff.changeSetTooLargeBody')}</p>
                </div>
              </div>
            </div>
          ) : files.length === 0 && !activeDiffSnapshot.hasChanges ? (
            <div className="flex h-full min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto">
              {collapseSummary}
              <div className="grid min-h-[55vh] flex-1 place-items-center">
                <div className="text-center">
                  <div className="text-[30px] leading-none">🧹</div>
                  <h3 className="mt-4 ui-text-base font-semibold tracking-tight ui-text-primary">{t('worktreeDiff.emptyTitle')}</h3>
                  <p className="mt-2 ui-text-base text-muted-foreground">{t('worktreeDiff.emptyBody')}</p>
                </div>
              </div>
            </div>
          ) : hasTruncatedButNoFiles ? (
            <div className="flex h-full min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto">
              {collapseSummary}
              <div className="grid min-h-[55vh] flex-1 place-items-center">
                <div className="text-center">
                  <h3 className="mt-4 ui-text-base font-semibold tracking-tight ui-text-primary">{t('worktreeDiff.largeDiffTitle')}</h3>
                  <p className="mt-2 ui-text-base text-muted-foreground">{t('worktreeDiff.previewUnavailable')}</p>
                </div>
              </div>
            </div>
          ) : (
            <DiffWorkerPoolBoundary enabled={workerPoolEnabled} onReady={markWorkerPoolReady}>
              <div
                id="review-diffs-collapsed"
                data-testid="worktree-diff-card-list"
                data-app-action-review-scroll=""
                data-thread-find-target="review"
                className="flex h-full min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto pb-8 [overflow-anchor:none]"
              >
                <div className="flex w-full flex-col">
                  <span
                    aria-hidden="true"
                    data-review-diff-metrics-probe=""
                    className="pointer-events-none invisible absolute left-0 top-0 block whitespace-pre"
                    style={{
                      fontFamily: 'var(--diffs-font-family)',
                      fontSize: 'var(--diffs-font-size)',
                      height: 'var(--diffs-line-height)',
                      lineHeight: 'var(--diffs-line-height)',
                    }}
                  />
                  <CodexFileTreeIconSprite />
                  {collapseSummary}
                  {hasTruncatedPreview ? (
                    <div className="mx-3 mb-2 flex-none rounded-[10px] border border-border/65 ui-surface-subtle px-3.5 py-2">
                      <div className="ui-text-meta ui-text-secondary">{t('worktreeDiff.partialPreview')}</div>
                    </div>
                  ) : null}
                  <div className="flex flex-col">
                    {files.map((file) => {
                      const loadedPatch = patchByPath[file.path]
                      const patch = file.patch ?? loadedPatch?.patch ?? ''
                      const expanded = expandedPaths.has(file.path)
                      const additions = loadedPatch?.additions ?? file.additions
                      const deletions = loadedPatch?.deletions ?? file.deletions
                      const truncated = loadedPatch?.truncated
                      const isImagePreview = canPreviewImage(file.path)
                      const fileParts = getFileDisplayParts(file.path)
                      const { className: fileIconClassName, token: fileIconToken } = getFileIconMeta(file.path)

                      return (
                        <DiffFileCard
                          key={file.path}
                          filePath={file.path}
                          pathDir={fileParts.dir}
                          pathName={fileParts.name}
                          fileIconClassName={fileIconClassName}
                          fileIconToken={fileIconToken}
                          untracked={file.untracked}
                          expanded={expanded}
                          additions={additions}
                          deletions={deletions}
                          toggleLabel={t('worktreeDiff.toggleFile')}
                          onToggle={() => toggleFile(file)}
                        >
                          <WorktreeDiffFileBody
                            path={file.path}
                            isImagePreview={isImagePreview}
                            previewState={previewByPath[file.path] ?? { status: 'idle' }}
                            patch={patch}
                            additions={additions}
                            deletions={deletions}
                            truncated={truncated}
                            diffViewMode={diffViewMode}
                            wrapDiffLines={wrapDiffLines}
                            statusMessage={isImagePreview || patch ? '' : getPatchStatusMessage(file.path)}
                            imageLabels={imagePreviewLabels}
                          />
                        </DiffFileCard>
                      )
                    })}
                  </div>
                </div>
              </div>
            </DiffWorkerPoolBoundary>
          )}
        </div>
      </div>
    </aside>
  )
}

function ReviewExpandToggleIcon(props: { expanded: boolean }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="size-5">
      <path d="M13 9.5L20 9.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M13 14.5L17 14.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M6.24 4V9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6.24 15V20" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      {props.expanded ? (
        <>
          <path d="M3.74 8.5L6.24 11L8.74 8.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M8.74 15.5L6.24 13L3.74 15.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : (
        <>
          <path d="M3.74 16.5L6.24 14L8.74 16.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M8.74 7.5L6.24 10L3.74 7.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
    </svg>
  )
}

function ReviewViewModeIcon(props: { mode: DiffRenderStyle }) {
  const split = props.mode === 'split'
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="size-5">
      <rect x="3.5" y="4.5" width="17" height="15" rx="3" stroke="currentColor" strokeWidth="2" />
      {split ? (
        <>
          <path d="M6 8C6 7.45 6.45 7 7 7H10.25C10.8 7 11.25 7.45 11.25 8V16C11.25 16.55 10.8 17 10.25 17H7C6.45 17 6 16.55 6 16V8Z" fill="#F84E63" fillOpacity="0.5" />
          <path d="M12.75 8C12.75 7.45 13.2 7 13.75 7H17C17.55 7 18 7.45 18 8V16C18 16.55 17.55 17 17 17H13.75C13.2 17 12.75 16.55 12.75 16V8Z" fill="#36D958" fillOpacity="0.5" />
        </>
      ) : (
        <>
          <path d="M6 8C6 7.45 6.45 7 7 7H17C17.55 7 18 7.45 18 8V10.25C18 10.8 17.55 11.25 17 11.25H7C6.45 11.25 6 10.8 6 10.25V8Z" fill="#F84E63" fillOpacity="0.5" />
          <path d="M6 13.75C6 13.2 6.45 12.75 7 12.75H17C17.55 12.75 18 13.2 18 13.75V16C18 16.55 17.55 17 17 17H7C6.45 17 6 16.55 6 16V13.75Z" fill="#36D958" fillOpacity="0.5" />
        </>
      )}
    </svg>
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
