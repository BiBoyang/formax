import { Component, useEffect, useMemo, useState, type ErrorInfo, type ReactNode } from 'react'
import { useI18n } from '../../app/i18n/I18nProvider'
import type { GuiMessageKey } from '../../app/i18n/messages'
import { cn } from '../../lib/utils'
import type {
  FileDiffMetadata,
  parsePatchFiles as parsePatchFilesType,
  setLanguageOverride as setLanguageOverrideType,
} from '@pierre/diffs'
import type { FileDiff as FileDiffType } from '@pierre/diffs/react'

export const DIFF_RENDER_MAX_PATCH_BYTES = 256_000
export const DIFF_RENDER_MAX_LINES = 4_000
const DIFF_RENDER_MAX_FULL_CONTENT_BYTES = 512_000
const DIFF_RENDER_MAX_FULL_CONTENT_LINES = DIFF_RENDER_MAX_LINES

export type DiffPreviewUnavailableReason =
  | 'invalid_patch'
  | 'unsupported_patch'
  | 'large_patch'
  | 'truncated_patch'
  | 'renderer_error'
  | 'empty_patch'
  | 'binary_patch'

export type DiffRenderStyle = 'unified' | 'split'

export type DiffPatchViewProps = {
  path?: string
  patch: string
  truncated?: boolean
  additions?: number
  deletions?: number
  maxHeightClassName?: string
  diffStyle?: DiffRenderStyle
  wordWrap?: boolean
  showFileHeader?: boolean
  fullContent?: {
    before: string
    after: string
  } | null
}

type ValidationResult =
  | { ok: true; renderKey: string; fileDiff: FileDiffMetadata; fullContentApplied: boolean }
  | { ok: false; reason: DiffPreviewUnavailableReason }

type PierreDiffsModules = {
  parsePatchFiles: typeof parsePatchFilesType
  setLanguageOverride: typeof setLanguageOverrideType
  FileDiff: typeof FileDiffType
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
const DIFF_RENDER_LINE_HEIGHT_PX = 23
const DIFF_RENDER_HEADER_HEIGHT_PX = 36
const PLAIN_TEXT_DIFF_EXTENSIONS = new Set(['md', 'markdown', 'mdc', 'mdx', 'mmd', 'mermaid'])
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
  --diffs-font-family: var(--font-mono, "JetBrains Mono", ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace);
  --diffs-font-size: 13px;
  --diffs-line-height: ${DIFF_RENDER_LINE_HEIGHT_PX}px;
  --diffs-gap-block: 0px;
  --diffs-fg: var(--foreground, #111111);
  --diffs-light: var(--foreground, #111111);
  -moz-osx-font-smoothing: grayscale;
  -webkit-font-smoothing: antialiased;
  font-synthesis: none;
  letter-spacing: normal;
  text-rendering: geometricPrecision;
}

[data-diff] {
  font-size: var(--diffs-font-size, 13px);
  font-weight: 400;
  font-synthesis: none;
  letter-spacing: normal;
  background: transparent;
  text-rendering: geometricPrecision;
}

[data-diffs-header="default"] {
  min-height: ${DIFF_RENDER_HEADER_HEIGHT_PX}px;
}

[data-line] {
  color: var(--foreground, #111111);
  font-synthesis: none;
}

[data-line] span[style*="#525252"] {
  color: var(--foreground, #111111) !important;
}

[data-code] {
  max-width: 100%;
  overflow-x: auto;
  overflow-y: clip;
  overscroll-behavior-x: contain;
}

[data-overflow="scroll"][data-diff-type="single"] [data-gutter] {
  position: sticky;
  left: 0;
  z-index: 4;
}

[data-overflow="scroll"][data-diff-type="split"] [data-gutter] {
  position: static;
  left: auto;
  z-index: auto;
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

const DIFFS_WORD_WRAP_UNSAFE_CSS = `
[data-code] {
  overflow-x: hidden;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

[data-code] * {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
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
    setLanguageOverride: diffs.setLanguageOverride,
    FileDiff: reactDiffs.FileDiff,
  })).catch((error) => {
    pierreDiffsModulePromise = null
    throw error
  })
  return pierreDiffsModulePromise
}

function getPathExtension(path: string | undefined): string {
  const fileName = path?.split(/[\\/]/).pop() ?? ''
  const dotIndex = fileName.lastIndexOf('.')
  if (dotIndex < 0 || dotIndex === fileName.length - 1) return ''
  return fileName.slice(dotIndex + 1).toLowerCase()
}

function shouldUsePlainTextLanguageOverride(path: string | undefined): boolean {
  return PLAIN_TEXT_DIFF_EXTENSIONS.has(getPathExtension(path))
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

function isFullContentWithinRenderBudget(fullContent: NonNullable<DiffPatchViewProps['fullContent']>): boolean {
  const totalBytes = getPatchByteLength(fullContent.before) + getPatchByteLength(fullContent.after)
  if (totalBytes > DIFF_RENDER_MAX_FULL_CONTENT_BYTES) return false

  const totalLines = getPatchLineCount(fullContent.before) + getPatchLineCount(fullContent.after)
  return totalLines <= DIFF_RENDER_MAX_FULL_CONTENT_LINES
}

function getPatchRenderKey(path: string | undefined, patch: string): string {
  return `${path ?? 'diff'}:${patch.length}:${getPatchHash(patch)}`
}

function getFullContentRenderKey(path: string | undefined, patch: string, fullContent: NonNullable<DiffPatchViewProps['fullContent']>): string {
  return `${getPatchRenderKey(path, patch)}:full:${fullContent.before.length}:${getPatchHash(fullContent.before)}:${fullContent.after.length}:${getPatchHash(fullContent.after)}`
}

function getPatchHash(patch: string): number {
  let hash = 0
  for (let index = 0; index < patch.length; index += 1) {
    hash = Math.imul(31, hash) + patch.charCodeAt(index)
    hash |= 0
  }
  return hash
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

function splitFileLines(content: string): string[] {
  if (!content) return []
  const lines = content.match(/[^\n]*(?:\n|$)/g) ?? []
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}

function linesMatch(left: string[], right: string[], leftStart: number, rightStart: number, count: number): boolean {
  for (let index = 0; index < count; index += 1) {
    if (left[leftStart + index] !== right[rightStart + index]) return false
  }
  return true
}

function buildFullContentMetadata(
  fileDiff: FileDiffMetadata,
  fullContent: NonNullable<DiffPatchViewProps['fullContent']>,
  cacheKey: string,
): FileDiffMetadata | null {
  const deletionLines = splitFileLines(fullContent.before)
  const additionLines = splitFileLines(fullContent.after)
  let splitLineCount = 0
  let unifiedLineCount = 0
  let previousAdditionEnd = 0
  let previousDeletionEnd = 0

  const hunks: FileDiffMetadata['hunks'] = []

  for (const hunk of fileDiff.hunks) {
    const additionLineIndex = Math.max(hunk.additionStart - 1, 0)
    const deletionLineIndex = Math.max(hunk.deletionStart - 1, 0)
    const additionCollapsedBefore = additionLineIndex - previousAdditionEnd
    const deletionCollapsedBefore = deletionLineIndex - previousDeletionEnd

    if (
      additionCollapsedBefore < 0 ||
      deletionCollapsedBefore < 0 ||
      additionCollapsedBefore !== deletionCollapsedBefore ||
      additionLineIndex + hunk.additionCount > additionLines.length ||
      deletionLineIndex + hunk.deletionCount > deletionLines.length
    ) {
      return null
    }

    if (!linesMatch(deletionLines, additionLines, previousDeletionEnd, previousAdditionEnd, additionCollapsedBefore)) {
      return null
    }

    let nextAdditionLineIndex = additionLineIndex
    let nextDeletionLineIndex = deletionLineIndex
    const hunkContent: FileDiffMetadata['hunks'][number]['hunkContent'] = []

    for (const content of hunk.hunkContent) {
      const additionCount = content.type === 'context' ? content.lines : content.additions
      const deletionCount = content.type === 'context' ? content.lines : content.deletions

      if (
        !linesMatch(fileDiff.additionLines, additionLines, content.additionLineIndex, nextAdditionLineIndex, additionCount) ||
        !linesMatch(fileDiff.deletionLines, deletionLines, content.deletionLineIndex, nextDeletionLineIndex, deletionCount)
      ) {
        return null
      }

      hunkContent.push({
        ...content,
        additionLineIndex: nextAdditionLineIndex,
        deletionLineIndex: nextDeletionLineIndex,
      })
      nextAdditionLineIndex += additionCount
      nextDeletionLineIndex += deletionCount
    }

    hunks.push({
      ...hunk,
      collapsedBefore: additionCollapsedBefore,
      additionLineIndex,
      deletionLineIndex,
      hunkContent,
      splitLineStart: splitLineCount + additionCollapsedBefore,
      unifiedLineStart: unifiedLineCount + additionCollapsedBefore,
    })

    splitLineCount += additionCollapsedBefore + hunk.splitLineCount
    unifiedLineCount += additionCollapsedBefore + hunk.unifiedLineCount
    previousAdditionEnd = additionLineIndex + hunk.additionCount
    previousDeletionEnd = deletionLineIndex + hunk.deletionCount
  }

  if (hunks.length > 0) {
    const additionTrailing = additionLines.length - previousAdditionEnd
    const deletionTrailing = deletionLines.length - previousDeletionEnd
    if (
      additionTrailing < 0 ||
      deletionTrailing < 0 ||
      additionTrailing !== deletionTrailing ||
      !linesMatch(deletionLines, additionLines, previousDeletionEnd, previousAdditionEnd, additionTrailing)
    ) {
      return null
    }
    splitLineCount += additionTrailing
    unifiedLineCount += additionTrailing
  }

  return {
    ...fileDiff,
    hunks,
    splitLineCount,
    unifiedLineCount,
    isPartial: false,
    deletionLines,
    additionLines,
    cacheKey,
  }
}

function validatePatch(props: DiffPatchViewProps, modules: PierreDiffsModules): ValidationResult {
  const patch = props.patch
  try {
    const parsedPatches = modules.parsePatchFiles(patch, getPatchRenderKey(props.path, patch), true)
    const parsedFiles = parsedPatches.flatMap((parsedPatch) => parsedPatch.files)
    if (parsedFiles.length !== 1) return { ok: false, reason: 'invalid_patch' }
    if (parsedFiles.every((file) => file.hunks.length === 0)) {
      return { ok: false, reason: 'unsupported_patch' }
    }
    const fullContent = props.fullContent && isFullContentWithinRenderBudget(props.fullContent) ? props.fullContent : null
    const fullContentRenderKey = fullContent ? getFullContentRenderKey(props.path, patch, fullContent) : null
    const fullContentFileDiff = fullContent
      ? buildFullContentMetadata(parsedFiles[0], fullContent, fullContentRenderKey ?? getPatchRenderKey(props.path, patch))
      : null
    const fullContentApplied = fullContentFileDiff != null
    const fileDiff = fullContentFileDiff ?? parsedFiles[0]
    const normalizedFileDiff = shouldUsePlainTextLanguageOverride(props.path)
      ? modules.setLanguageOverride(fileDiff, 'text')
      : fileDiff
    return {
      ok: true,
      renderKey: fullContentApplied && fullContentRenderKey ? fullContentRenderKey : getPatchRenderKey(props.path, patch),
      fileDiff: normalizedFileDiff,
      fullContentApplied,
    }
  } catch {
    return { ok: false, reason: 'invalid_patch' }
  }
}

function DiffPreviewLoading(props: { maxHeightClassName?: string }) {
  const { t } = useI18n()
  return (
    <div className="rounded-b-[10px] border-x border-b border-border/70 bg-muted/25">
      <div
        data-testid="diff-preview-loading"
        className={cn('min-w-0 px-4 py-3 ui-text-meta ui-text-secondary', props.maxHeightClassName)}
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
          'min-w-0 px-4 py-3',
          props.maxHeightClassName,
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
  const [renderedPatchKey, setRenderedPatchKey] = useState<string | null>(null)
  const diffStyle = props.diffStyle ?? 'unified'
  const showFileHeader = props.showFileHeader ?? true
  const wordWrap = props.wordWrap ?? false
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
  }, [preflightUnavailableReason, props.patch, props.path])

  const validation = useMemo(() => {
    if (!modules) return null
    return validatePatch(props, modules)
  }, [modules, props.fullContent, props.patch, props.path, props.truncated])
  const validationRenderKey = validation?.ok ? validation.renderKey : null
  const renderCompletionKey = validationRenderKey
    ? `${validationRenderKey}:${diffStyle}:${wordWrap ? 'wrap' : 'scroll'}:${showFileHeader ? 'header' : 'body'}`
    : null

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

  const LoadedFileDiff = modules.FileDiff
  const isRendered = renderedPatchKey === renderCompletionKey
  const unsafeCSS = wordWrap
    ? `${DIFFS_UNSAFE_CSS}\n${DIFFS_WORD_WRAP_UNSAFE_CSS}`
    : DIFFS_UNSAFE_CSS

  return (
    <div className="bg-muted/35 rounded-b-[10px] overflow-hidden">
      {!isRendered ? <DiffPreviewLoading maxHeightClassName={props.maxHeightClassName} /> : null}
      <div
        data-testid="pierre-diff-view"
        data-word-wrap={wordWrap ? 'true' : 'false'}
        className={cn(
          'min-w-0 overflow-x-hidden overflow-y-auto font-mono text-[13px]',
          props.maxHeightClassName,
        )}
      >
        <DiffPatchViewErrorBoundary key={validation.renderKey} fallback={unavailableFallback}>
          <LoadedFileDiff
            key={`${validation.renderKey}:${wordWrap ? 'wrap' : 'scroll'}`}
            fileDiff={validation.fileDiff}
            metrics={{
              hunkLineCount: 50,
              lineHeight: DIFF_RENDER_LINE_HEIGHT_PX,
              diffHeaderHeight: DIFF_RENDER_HEADER_HEIGHT_PX,
              spacing: 8,
              paddingTop: 8,
              paddingBottom: 8,
            }}
            options={{
              diffStyle,
              disableFileHeader: !showFileHeader,
              hunkSeparators: validation.fullContentApplied ? 'line-info' : 'line-info-basic',
              expandUnchanged: false,
              collapsedContextThreshold: 6,
              expansionLineCount: 20,
              lineDiffType: 'none',
              overflow: 'scroll',
              theme: 'pierre-light-soft',
              themeType: 'light',
              tokenizeMaxLength: 40_000,
              tokenizeMaxLineLength: 1_000,
              unsafeCSS: SHOULD_INJECT_UNSAFE_CSS ? unsafeCSS : undefined,
              onPostRender: (_node, _instance, phase) => {
                if (phase === 'unmount' || !renderCompletionKey) return
                setRenderedPatchKey(renderCompletionKey)
              },
            }}
          />
        </DiffPatchViewErrorBoundary>
      </div>
    </div>
  )
}
