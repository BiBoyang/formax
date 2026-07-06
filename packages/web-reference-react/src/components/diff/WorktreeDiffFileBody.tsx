import { useEffect } from 'react'
import { DiffPatchView, type DiffRenderStyle } from './DiffPatchView'
import { ImagePreviewBody } from './ImagePreviewBody'
import type { FullContentState, ImagePreviewState } from './diffTypes'

export function WorktreeDiffFileBody(props: {
  path: string
  isImagePreview: boolean
  previewState: ImagePreviewState
  patch: string
  fullContentState: FullContentState
  loadFullContent: boolean
  onRequestFullContent?: (path: string) => void
  additions: number
  deletions: number
  truncated?: boolean
  diffViewMode: DiffRenderStyle
  wrapDiffLines: boolean
  statusMessage: string
  imageLabels: {
    loading: string
    unavailable: string
    deleted: string
    alt: string
  }
}) {
  useEffect(() => {
    if (
      props.isImagePreview ||
      !props.loadFullContent ||
      !props.patch ||
      !props.onRequestFullContent ||
      props.fullContentState.status === 'loading' ||
      props.fullContentState.status === 'ready' ||
      props.fullContentState.status === 'error'
    ) {
      return
    }

    let timeoutId: number | null = null
    const frameId = window.requestAnimationFrame(() => {
      timeoutId = window.setTimeout(() => {
        props.onRequestFullContent?.(props.path)
      }, 0)
    })

    return () => {
      window.cancelAnimationFrame(frameId)
      if (timeoutId != null) {
        window.clearTimeout(timeoutId)
      }
    }
  }, [
    props.fullContentState.status,
    props.isImagePreview,
    props.loadFullContent,
    props.onRequestFullContent,
    props.patch,
    props.path,
  ])

  if (props.isImagePreview) {
    return (
      <ImagePreviewBody
        path={props.path}
        state={props.previewState}
        loadingLabel={props.imageLabels.loading}
        unavailableLabel={props.imageLabels.unavailable}
        deletedLabel={props.imageLabels.deleted}
        alt={props.imageLabels.alt}
      />
    )
  }

  if (props.patch) {
    const fullContent = props.fullContentState.status === 'ready' ? props.fullContentState.content : null
    return (
      <DiffPatchView
        path={props.path}
        patch={props.patch}
        fullContent={fullContent}
        additions={props.additions}
        deletions={props.deletions}
        truncated={props.truncated}
        diffStyle={props.diffViewMode}
        wordWrap={props.wrapDiffLines}
        showFileHeader={false}
      />
    )
  }

  return (
    <div
      data-testid="worktree-diff-file-status"
      className="border-x border-b border-border/70 bg-muted/25 px-4 py-3 ui-text-meta text-muted-foreground"
    >
      {props.statusMessage}
    </div>
  )
}
