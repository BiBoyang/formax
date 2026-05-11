import { ChevronDown, ChevronRight, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useI18n } from '../app/i18n/I18nProvider'
import type { RequestCollapseSummary } from '../types'
import { ScrollArea } from './ui/scroll-area'
import { cn } from '../lib/utils'
import { shouldStopWheelPropagation } from './scrollBoundary'
import { DiffPatchView } from './diff/DiffPatchView'
import { truncatePathFromLeft, type DiffFileViewModel } from './diff/diffTypes'

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
  diffSnapshot?: DiffSnapshot | null
  latestRequestCollapse?: RequestCollapseSummary | null
  onRefreshDiff?: () => void
  onRequestPatch?: (filePath: string) => Promise<DiffFilePatchPayload | null>
  isRefreshingDiff?: boolean
  showHeader?: boolean
}

const MAX_RENDERABLE_DIFF_FILES = 120

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
  const [openFiles, setOpenFiles] = useState<Record<string, boolean>>({})
  const [listOpen, setListOpen] = useState(true)
  const [patchByPath, setPatchByPath] = useState<Record<string, DiffFilePatchPayload>>({})
  const [patchLoadingByPath, setPatchLoadingByPath] = useState<Record<string, boolean>>({})
  const [patchErrorByPath, setPatchErrorByPath] = useState<Record<string, PatchErrorKind>>({})
  const diffScrollAreaRef = useRef<HTMLDivElement | null>(null)
  const snapshotKeyRef = useRef<string>('')
  const files = diffSnapshot?.files ?? []
  const exceedsRenderFileLimit = files.length > MAX_RENDERABLE_DIFF_FILES
  const isLargeChangeSet = Boolean(diffSnapshot && diffSnapshot.hasChanges && exceedsRenderFileLimit)
  const hasTruncatedPreview = Boolean(diffSnapshot?.truncated)
  const hasTruncatedButNoFiles = Boolean(diffSnapshot?.hasChanges && diffSnapshot?.truncated && files.length === 0)
  const collapsePhaseLabel =
    latestRequestCollapse?.phase === 'reactive_retry'
      ? t('appShell.collapsePhase.reactiveRetry')
      : t('appShell.collapsePhase.initial')

  useEffect(() => {
    snapshotKeyRef.current = `${diffSnapshot?.cwd ?? ''}:${diffSnapshot?.generatedAt ?? ''}`
    setPatchByPath({})
    setPatchLoadingByPath({})
    setPatchErrorByPath({})
  }, [diffSnapshot?.cwd, diffSnapshot?.generatedAt])

  useEffect(() => {
    const root = diffScrollAreaRef.current
    if (!root) return
    const viewport = root.querySelector<HTMLElement>('[data-radix-scroll-area-viewport]')
    if (!viewport) return
    const onWheel = (event: WheelEvent) => {
      if (
        shouldStopWheelPropagation({
          deltaY: event.deltaY,
          scrollTop: viewport.scrollTop,
          scrollHeight: viewport.scrollHeight,
          clientHeight: viewport.clientHeight,
        })
      ) {
        event.stopPropagation()
      }
    }
    viewport.addEventListener('wheel', onWheel, { passive: true })
    return () => {
      viewport.removeEventListener('wheel', onWheel)
    }
  }, [files.length, listOpen])

  const requestPatch = useCallback(async (filePath: string) => {
    if (!onRequestPatch) return
    if (patchByPath[filePath]) return
    if (patchLoadingByPath[filePath]) return

    const requestSnapshotKey = snapshotKeyRef.current
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
        setPatchErrorByPath((prev) => ({ ...prev, [filePath]: 'unavailable' }))
        return
      }
      setPatchByPath((prev) => ({ ...prev, [filePath]: payload }))
    } catch {
      if (snapshotKeyRef.current !== requestSnapshotKey) return
      setPatchErrorByPath((prev) => ({ ...prev, [filePath]: 'load_failed' }))
    } finally {
      setPatchLoadingByPath((prev) => {
        if (snapshotKeyRef.current !== requestSnapshotKey) return prev
        if (!prev[filePath]) return prev
        const next = { ...prev }
        delete next[filePath]
        return next
      })
    }
  }, [onRequestPatch, patchByPath, patchLoadingByPath])

  useEffect(() => {
    if (!onRequestPatch) return
    if (!diffSnapshot) return
    const openPaths = Object.entries(openFiles)
      .filter(([, open]) => open)
      .map(([path]) => path)
    if (openPaths.length === 0) return
    for (const path of openPaths) {
      const file = files.find((entry) => entry.path === path)
      if (!file) continue
      if (file.patch) continue
      if (patchByPath[path]) continue
      if (patchLoadingByPath[path]) continue
      if (patchErrorByPath[path]) continue
      void requestPatch(path)
    }
  }, [diffSnapshot, files, onRequestPatch, openFiles, patchByPath, patchLoadingByPath, patchErrorByPath, requestPatch])

  const toggleFile = (file: DiffFile, open: boolean) => {
    const nextOpen = !open
    setOpenFiles((prev) => ({ ...prev, [file.path]: nextOpen }))
    if (!nextOpen) return
    if (file.patch) return
    void requestPatch(file.path)
  }

  return (
    <aside
      data-testid="worktree-diff-pane"
      className="h-full w-full min-w-0 flex flex-col overflow-hidden overflow-x-hidden bg-background selection:bg-primary/10"
    >
      {showHeader ? (
        <div className="flex-none flex items-center justify-between px-6 h-14 bg-background z-[30]">
          <div className="flex items-center gap-1.5 cursor-pointer select-none" onClick={() => setListOpen(!listOpen)}>
            <h2 className="ui-text-base font-semibold ui-text-primary">{t('worktreeDiff.title')}</h2>
            <ChevronDown className={cn('size-3.5 ui-text-secondary transition-transform', !listOpen && '-rotate-90')} />
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2.5 ui-text-secondary">
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

      <div className="flex-1 min-h-0 min-w-0 relative">
        <ScrollArea ref={diffScrollAreaRef} className="h-full min-w-0 px-6 pb-20">
          <div className="relative">
            <div className="sticky top-0 h-4 w-full bg-background z-[15] -mt-1 pointer-events-none" />

            {latestRequestCollapse ? (
              <div
                data-testid="worktree-collapse-summary"
                className="mb-3 rounded-[10px] border border-border/65 ui-surface-subtle px-3.5 py-3"
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
                <div className="min-h-[55vh] grid place-items-center">
                  <div className="text-center">
                    <h3 className="mt-4 ui-text-base font-semibold tracking-tight ui-text-primary">{t('worktreeDiff.changeSetTooLargeTitle')}</h3>
                    <p className="mt-2 ui-text-base text-muted-foreground">{t('worktreeDiff.changeSetTooLargeBody')}</p>
                  </div>
                </div>
              ) : files.length === 0 && !diffSnapshot.hasChanges ? (
                <div className="min-h-[55vh] grid place-items-center">
                  <div className="text-center">
                    <div className="text-[30px] leading-none">🧹</div>
                    <h3 className="mt-4 ui-text-base font-semibold tracking-tight ui-text-primary">{t('worktreeDiff.emptyTitle')}</h3>
                    <p className="mt-2 ui-text-base text-muted-foreground">{t('worktreeDiff.emptyBody')}</p>
                  </div>
                </div>
              ) : hasTruncatedButNoFiles ? (
                <div className="min-h-[55vh] grid place-items-center">
                  <div className="text-center">
                    <h3 className="mt-4 ui-text-base font-semibold tracking-tight ui-text-primary">{t('worktreeDiff.largeDiffTitle')}</h3>
                    <p className="mt-2 ui-text-base text-muted-foreground">{t('worktreeDiff.previewUnavailable')}</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-2 pt-1">
                  {hasTruncatedPreview ? (
                    <div className="rounded-[10px] border border-border/65 ui-surface-subtle px-3.5 py-2">
                      <div className="ui-text-meta ui-text-secondary">{t('worktreeDiff.partialPreview')}</div>
                    </div>
                  ) : null}
                  {files.map((file) => {
                    const open = Boolean(openFiles[file.path])
                    const loadedPatch = patchByPath[file.path]
                    const patch = file.patch ?? loadedPatch?.patch ?? ''
                    const displayAdditions = loadedPatch?.additions ?? file.additions
                    const displayDeletions = loadedPatch?.deletions ?? file.deletions
                    const patchLoading = Boolean(patchLoadingByPath[file.path])
                    const patchError = patchErrorByPath[file.path]
                    const patchErrorMessage =
                      patchError === 'load_failed'
                        ? t('worktreeDiff.patchLoadFailed')
                        : patchError === 'unavailable'
                          ? t('worktreeDiff.patchUnavailable')
                          : null

                    return (
                      <div key={file.path} className="flex min-w-0 flex-col group relative">
                        <button
                          data-testid={`diff-file-row-${file.path}`}
                          className={cn(
                            'flex min-w-0 items-center justify-between w-full text-left px-3.5 py-2 transition-colors',
                            'ui-surface-subtle',
                            'border border-transparent',
                            open && 'border-b-border/50',
                            open ? 'rounded-t-[10px]' : 'rounded-[10px]',
                          )}
                          onClick={() => toggleFile(file, open)}
                        >
                          <div className="flex items-center gap-x-2.5 min-w-0 flex-1">
                            <span
                              title={file.path}
                              className={cn(
                                'font-mono min-w-0 truncate ui-text-primary transition-colors',
                                open ? 'ui-text-base leading-4 font-medium' : 'ui-text-base leading-4 font-normal',
                              )}
                            >
                              {truncatePathFromLeft(file.path)}
                            </span>
                            <div className="flex items-center gap-1 ui-text-base leading-4 font-mono font-normal shrink-0">
                              <span className="ui-text-diff-add">+{displayAdditions}</span>
                              <span className="ui-text-diff-del">-{displayDeletions}</span>
                              {file.untracked ? <div className="size-1.5 rounded-full ui-dot-untracked ml-1" /> : null}
                            </div>
                          </div>

                          <div className="flex items-center shrink-0 ml-4 opacity-0 group-hover:opacity-100 transition-opacity">
                            {open ? (
                              <ChevronDown className="size-4 ui-text-secondary" />
                            ) : (
                              <ChevronRight className="size-4 ui-text-secondary" />
                            )}
                          </div>
                        </button>
                        {open ? (
                          patch ? (
                            <DiffPatchView patch={patch} />
                          ) : patchLoading || (onRequestPatch && !patchError && !file.patch) ? (
                            <div className="rounded-b-[10px] border-x border-b border-border/70 px-4 py-3 ui-text-meta ui-text-secondary bg-white">
                              {t('worktreeDiff.loadingPatch')}
                            </div>
                          ) : (
                            <div className="rounded-b-[10px] border-x border-b border-border/70 px-4 py-3 ui-text-meta text-muted-foreground bg-white">
                              {patchErrorMessage ?? t('worktreeDiff.patchUnavailable')}
                            </div>
                          )
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              )
            ) : null}
          </div>
        </ScrollArea>
      </div>
    </aside>
  )
}
