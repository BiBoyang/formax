import { cn } from '../../lib/utils'
import type { ImagePreviewState } from './diffTypes'

export function ImagePreviewBody(props: {
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
