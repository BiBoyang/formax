import { Component, useEffect, useMemo, useState, type ErrorInfo, type ReactNode } from 'react'
import { useI18n } from '../../app/i18n/I18nProvider'
import type { GuiMessageKey } from '../../app/i18n/messages'
import { cn } from '../../lib/utils'
import type { parsePatchFiles as parsePatchFilesType } from '@pierre/diffs'
import type { PatchDiff as PatchDiffType } from '@pierre/diffs/react'

export const DIFF_RENDER_MAX_PATCH_BYTES = 256_000
export const DIFF_RENDER_MAX_LINES = 4_000

export type DiffPreviewUnavailableReason =
  | 'invalid_patch'
  | 'unsupported_patch'
  | 'large_patch'
  | 'truncated_patch'
  | 'renderer_error'
  | 'empty_patch'
  | 'binary_patch'

export type DiffPatchViewProps = {
  path?: string
  patch: string
  truncated?: boolean
  additions?: number
  deletions?: number
  maxHeightClassName?: string
}

type ValidationResult =
  | { ok: true; renderKey: string }
  | { ok: false; reason: DiffPreviewUnavailableReason }

type PierreDiffsModules = {
  parsePatchFiles: typeof parsePatchFilesType
  PatchDiff: typeof PatchDiffType
}

type DiffPatchViewErrorBoundaryProps = {
  fallback: ReactNode
  children: ReactNode
}

type DiffPatchViewErrorBoundaryState = {
  failed: boolean
}

const TRUNCATED_PATCH_MARKER = '... [file patch truncated]'
const BINARY_PATCH_PATTERN = /(^|\n)(Binary files .+ differ|GIT binary patch)(\n|$)/
const SHOULD_INJECT_UNSAFE_CSS = import.meta.env.MODE !== 'test'
let pierreDiffsModulePromise: Promise<PierreDiffsModules> | null = null

const PREVIEW_UNAVAILABLE_MESSAGE_KEYS: Record<DiffPreviewUnavailableReason, GuiMessageKey> = {
  invalid_patch: 'worktreeDiff.previewUnavailable.invalidPatch',
  unsupported_patch: 'worktreeDiff.previewUnavailable.unsupportedPatch',
  large_patch: 'worktreeDiff.previewUnavailable.largePatch',
  truncated_patch: 'worktreeDiff.previewUnavailable.truncatedPatch',
  renderer_error: 'worktreeDiff.previewUnavailable.rendererError',
  empty_patch: 'worktreeDiff.previewUnavailable.emptyPatch',
  binary_patch: 'worktreeDiff.previewUnavailable.binaryPatch',
}

const DIFFS_UNSAFE_CSS = `
:host {
  --diffs-font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace);
}

[data-diff] {
  font-size: 12px;
  line-height: 1.55;
  background: transparent;
}

[data-gutter] {
  color: color-mix(in oklab, hsl(var(--muted-foreground)) 42%, transparent);
}

[data-line-type="addition"] {
  background: color-mix(in oklab, rgb(16 185 129) 7%, transparent);
}

[data-line-type="deletion"] {
  background: color-mix(in oklab, rgb(239 68 68) 7%, transparent);
}
`

class DiffPatchViewErrorBoundary extends Component<
  DiffPatchViewErrorBoundaryProps,
  DiffPatchViewErrorBoundaryState
> {
  state: DiffPatchViewErrorBoundaryState = { failed: false }

  static getDerivedStateFromError(): DiffPatchViewErrorBoundaryState {
    return { failed: true }
  }

  componentDidCatch(error: unknown, errorInfo: ErrorInfo) {
    if (import.meta.env.DEV) {
      console.warn('Diff renderer failed', error, errorInfo)
    }
  }

  render() {
    if (this.state.failed) return this.props.fallback
    return this.props.children
  }
}

function loadPierreDiffsModules(): Promise<PierreDiffsModules> {
  pierreDiffsModulePromise ??= Promise.all([
    import('@pierre/diffs'),
    import('@pierre/diffs/react'),
  ]).then(([diffs, reactDiffs]) => ({
    parsePatchFiles: diffs.parsePatchFiles,
    PatchDiff: reactDiffs.PatchDiff,
  })).catch((error) => {
    pierreDiffsModulePromise = null
    throw error
  })
  return pierreDiffsModulePromise
}

function getPatchByteLength(patch: string): number {
  if (typeof TextEncoder === 'function') {
    return new TextEncoder().encode(patch).byteLength
  }
  return patch.length
}

function getPatchLineCount(patch: string): number {
  if (!patch) return 0
  return patch.split('\n').length
}

function getEstimatedRenderHeight(patch: string): number {
  return Math.min(1_200, Math.max(64, getPatchLineCount(patch) * 20 + 24))
}

function getPatchRenderKey(path: string | undefined, patch: string): string {
  let hash = 0
  for (let index = 0; index < patch.length; index += 1) {
    hash = Math.imul(31, hash) + patch.charCodeAt(index)
    hash |= 0
  }
  return `${path ?? 'diff'}:${patch.length}:${hash}`
}

function getPreflightUnavailableReason(props: DiffPatchViewProps): DiffPreviewUnavailableReason | null {
  const patch = props.patch
  if (!patch.trim()) return 'empty_patch'
  if (props.truncated || patch.includes(TRUNCATED_PATCH_MARKER)) {
    return 'truncated_patch'
  }
  if (BINARY_PATCH_PATTERN.test(patch)) {
    return 'binary_patch'
  }
  if (
    getPatchByteLength(patch) > DIFF_RENDER_MAX_PATCH_BYTES ||
    getPatchLineCount(patch) > DIFF_RENDER_MAX_LINES
  ) {
    return 'large_patch'
  }
  return null
}

function validatePatch(props: DiffPatchViewProps, parsePatchFiles: typeof parsePatchFilesType): ValidationResult {
  const patch = props.patch
  try {
    const parsedPatches = parsePatchFiles(patch, getPatchRenderKey(props.path, patch), true)
    const parsedFiles = parsedPatches.flatMap((parsedPatch) => parsedPatch.files)
    if (parsedFiles.length === 0) return { ok: false, reason: 'invalid_patch' }
    if (parsedFiles.every((file) => file.hunks.length === 0)) {
      return { ok: false, reason: 'unsupported_patch' }
    }
  } catch {
    return { ok: false, reason: 'invalid_patch' }
  }

  return { ok: true, renderKey: getPatchRenderKey(props.path, patch) }
}

function DiffPreviewLoading(props: { maxHeightClassName?: string }) {
  const { t } = useI18n()
  return (
    <div className="rounded-b-[10px] border-x border-b border-border/70 bg-muted/25">
      <div
        data-testid="diff-preview-loading"
        className={cn('min-w-0 overflow-y-auto px-4 py-3 ui-text-meta ui-text-secondary', props.maxHeightClassName ?? 'max-h-[1200px]')}
      >
        {t('worktreeDiff.loadingPatch')}
      </div>
    </div>
  )
}

function DiffPreviewUnavailable(props: {
  reason: DiffPreviewUnavailableReason
  path?: string
  additions?: number
  deletions?: number
  maxHeightClassName?: string
}) {
  const { t } = useI18n()
  return (
    <div className="rounded-b-[10px] border-x border-b border-border/70 bg-muted/25">
      <div
        data-testid="diff-preview-unavailable"
        data-reason={props.reason}
        className={cn(
          'min-w-0 overflow-y-auto px-4 py-3',
          props.maxHeightClassName ?? 'max-h-[1200px]',
        )}
      >
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="ui-text-base font-medium ui-text-primary">
              {t('worktreeDiff.previewUnavailableTitle')}
            </div>
            {props.path ? (
              <div className="mt-1 truncate font-mono text-[11px] ui-text-secondary" title={props.path}>
                {props.path}
              </div>
            ) : null}
            <div className="mt-1 ui-text-meta ui-text-secondary">
              {t(PREVIEW_UNAVAILABLE_MESSAGE_KEYS[props.reason])}
            </div>
          </div>
          {props.additions != null || props.deletions != null ? (
            <div className="shrink-0 font-mono text-[11px] leading-5">
              {props.additions != null ? (
                <span className="ui-text-diff-add">+{props.additions}</span>
              ) : null}
              {props.deletions != null ? (
                <span className="ml-2 ui-text-diff-del">-{props.deletions}</span>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export function DiffPatchView(props: DiffPatchViewProps) {
  const [modules, setModules] = useState<PierreDiffsModules | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const preflightUnavailableReason = useMemo(
    () => getPreflightUnavailableReason(props),
    [props.patch, props.truncated],
  )

  useEffect(() => {
    if (preflightUnavailableReason) return
    let cancelled = false
    loadPierreDiffsModules()
      .then((loadedModules) => {
        if (!cancelled) {
          setModules(loadedModules)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLoadFailed(true)
        }
      })
    return () => {
      cancelled = true
    }
  }, [preflightUnavailableReason])

  const validation = useMemo(() => {
    if (!modules) return null
    return validatePatch(props, modules.parsePatchFiles)
  }, [modules, props.patch, props.path, props.truncated])

  const unavailableFallback = (
    <DiffPreviewUnavailable
      reason="renderer_error"
      path={props.path}
      additions={props.additions}
      deletions={props.deletions}
      maxHeightClassName={props.maxHeightClassName}
    />
  )

  if (preflightUnavailableReason) {
    return (
      <DiffPreviewUnavailable
        reason={preflightUnavailableReason}
        path={props.path}
        additions={props.additions}
        deletions={props.deletions}
        maxHeightClassName={props.maxHeightClassName}
      />
    )
  }

  if (loadFailed) {
    return unavailableFallback
  }

  if (!modules || !validation) {
    return <DiffPreviewLoading maxHeightClassName={props.maxHeightClassName} />
  }

  if (!validation.ok) {
    return (
      <DiffPreviewUnavailable
        reason={validation.reason}
        path={props.path}
        additions={props.additions}
        deletions={props.deletions}
        maxHeightClassName={props.maxHeightClassName}
      />
    )
  }

  const LoadedPatchDiff = modules.PatchDiff
  const estimatedRenderHeight = getEstimatedRenderHeight(props.patch)

  return (
    <div className="bg-muted/35 rounded-b-[10px] overflow-hidden">
      <div
        data-testid="pierre-diff-view"
        className={cn(
          'min-w-0 overflow-x-hidden overflow-y-auto font-mono text-[12px] leading-relaxed',
          props.maxHeightClassName ?? 'max-h-[1200px]',
        )}
      >
        <DiffPatchViewErrorBoundary key={validation.renderKey} fallback={unavailableFallback}>
          <LoadedPatchDiff
            key={validation.renderKey}
            patch={props.patch}
            disableWorkerPool
            metrics={{
              hunkLineCount: 50,
              lineHeight: 20,
              diffHeaderHeight: 0,
              spacing: 8,
              paddingTop: 8,
              paddingBottom: 8,
            }}
            style={{
              display: 'block',
              minHeight: `${estimatedRenderHeight}px`,
            }}
            options={{
              diffStyle: 'unified',
              disableFileHeader: false,
              hunkSeparators: 'line-info-basic',
              lineDiffType: 'word',
              overflow: 'wrap',
              theme: 'pierre-light-soft',
              themeType: 'light',
              tokenizeMaxLength: 40_000,
              tokenizeMaxLineLength: 1_000,
              unsafeCSS: SHOULD_INJECT_UNSAFE_CSS ? DIFFS_UNSAFE_CSS : undefined,
            }}
          />
        </DiffPatchViewErrorBoundary>
      </div>
    </div>
  )
}
