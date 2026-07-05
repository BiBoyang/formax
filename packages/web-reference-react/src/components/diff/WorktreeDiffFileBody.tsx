import { DiffPatchView, type DiffRenderStyle } from './DiffPatchView'
import { ImagePreviewBody } from './ImagePreviewBody'
import type { ImagePreviewState } from './diffTypes'

export function WorktreeDiffFileBody(props: {
  path: string
  isImagePreview: boolean
  previewState: ImagePreviewState
  patch: string
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
    return (
      <DiffPatchView
        path={props.path}
        patch={props.patch}
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
