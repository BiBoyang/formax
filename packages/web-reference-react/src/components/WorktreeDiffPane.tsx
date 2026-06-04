import { ChevronDown, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { WorkerPoolOptions } from '@pierre/diffs/react'
import { useI18n } from '../app/i18n/I18nProvider'
import type { RequestCollapseSummary } from '../types'
import { cn } from '../lib/utils'
import { DiffPatchView, type DiffRenderStyle } from './diff/DiffPatchView'
import { type DiffFileViewModel } from './diff/diffTypes'

type DiffFile = DiffFileViewModel
type PatchErrorKind = 'unavailable' | 'load_failed'

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
  isRefreshingDiff?: boolean
  showHeader?: boolean
}

const MAX_RENDERABLE_DIFF_FILES = 120
const DIFF_WORKER_POOL_PROVIDER_SETTLE_MS = 50
const DIFF_VIEW_MODES: DiffRenderStyle[] = ['unified', 'split']
type DiffWorkerPoolModuleState = {
  status: 'ready'
  Provider: typeof import('@pierre/diffs/react').WorkerPoolContextProvider
  poolOptions: WorkerPoolOptions
} | { status: 'failed' }

export function WorktreeDiffPane(props: WorktreeDiffPaneProps) {
  const { t } = useI18n()
  const {
    diffSnapshot = null,
    latestRequestCollapse = null,
    onRefreshDiff,
    onRequestPatch,
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

  const requestPatchIfNeeded = useCallback((file: DiffFile) => {
    if (!file.patch && !patchByPath[file.path] && !patchLoadingByPath[file.path]) {
      void requestPatch(file.path)
    }
  }, [patchByPath, patchLoadingByPath, requestPatch])

  const applyFileToggle = useCallback((file: DiffFile, options?: { requestPatch?: boolean }) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev)
      if (next.has(file.path)) {
        next.delete(file.path)
        return next
      }

      next.add(file.path)
      if (options?.requestPatch !== false) {
        requestPatchIfNeeded(file)
      }
      return next
    })
  }, [requestPatchIfNeeded])

  const clearPendingFirstToggle = useCallback(() => {
    pendingFirstTogglePathRef.current = null
  }, [])

  const toggleFile = useCallback((file: DiffFile) => {
    if (!workerPoolReady && typeof Worker === 'function') {
      setWorkerPoolEnabled(true)
      requestPatchIfNeeded(file)
      if (pendingFirstTogglePathRef.current === file.path) return
      pendingFirstTogglePathRef.current = file.path
      return
    }

    clearPendingFirstToggle()
    applyFileToggle(file)
  }, [applyFileToggle, clearPendingFirstToggle, requestPatchIfNeeded, workerPoolReady])

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
      if (file.patch || patchByPath[file.path] || patchLoadingByPath[file.path]) continue
      if (patchErrorByPath[file.path]) continue
      void requestPatch(file.path)
    }
  }, [expandedPaths, files, onRequestPatch, patchByPath, patchErrorByPath, patchLoadingByPath, requestPatch, snapshotKey])

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
                {files.map((file) => {
                  const loadedPatch = patchByPath[file.path]
                  const patch = file.patch ?? loadedPatch?.patch ?? ''
                  const expanded = expandedPaths.has(file.path)
                  const additions = loadedPatch?.additions ?? file.additions
                  const deletions = loadedPatch?.deletions ?? file.deletions
                  const truncated = loadedPatch?.truncated
                  const body = patch ? (
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
