import { ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

export function DiffFileCard(props: {
  filePath: string
  pathDir: string
  pathName: string
  fileIconClassName: string
  fileIconToken: string
  untracked?: boolean
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
      data-review-path={props.filePath}
      data-expanded={props.expanded ? 'true' : 'false'}
      className="group/file-diff flex min-w-0 flex-col overflow-clip bg-background"
    >
      <div
        role="button"
        tabIndex={0}
        className="cursor-pointer select-none bg-background focus-visible:outline-none"
        onClick={props.onToggle}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault()
          props.onToggle()
        }}
      >
        <div className="group/diff-header @container/diff-header relative mb-0.5 flex min-h-8 items-center gap-2 py-0.5 pe-2 ps-3 text-size-chat hover:bg-muted/55">
          <div className="flex min-w-0 flex-1 items-center gap-0.5 text-foreground">
            <div className="flex min-w-0 items-center gap-2 pl-1">
              <span
                aria-hidden="true"
                data-file-icon-token={props.fileIconToken}
                className={cn('inline-flex size-4 shrink-0 items-center justify-center', props.fileIconClassName)}
              >
                <svg aria-hidden="true" className="size-4 shrink-0" viewBox="0 0 16 16">
                  <use href={`#file-tree-builtin-${props.fileIconToken}`} />
                </svg>
              </span>
              <span
                className="min-w-0 truncate text-start text-foreground [direction:rtl]"
                title={props.filePath}
              >
                <span className="sr-only">{props.filePath}</span>
                <span className="min-w-0 truncate [direction:ltr] [unicode-bidi:plaintext]">
                  {props.pathDir ? (
                    <span className="text-muted-foreground">{props.pathDir}</span>
                  ) : null}
                  <span className="text-foreground">{props.pathName}</span>
                </span>
              </span>
            </div>
            <button
              type="button"
              data-testid="worktree-diff-file-toggle"
              data-app-action-review-file-toggle=""
              data-app-action-review-file-expanded={props.expanded ? 'true' : 'false'}
              aria-label={props.toggleLabel}
              aria-expanded={props.expanded}
              className="inline-flex size-5 shrink-0 items-center justify-center rounded-md bg-transparent text-muted-foreground/55 opacity-0 transition-[color,opacity,transform] duration-150 hover:bg-transparent hover:text-muted-foreground group-focus-within/diff-header:opacity-100 group-hover/diff-header:opacity-100"
              onKeyDown={(event) => {
                event.stopPropagation()
              }}
              onClick={(event) => {
                event.stopPropagation()
                props.onToggle()
              }}
            >
              <ChevronRight
                className={cn(
                  'size-4 transition-transform duration-200',
                  props.expanded ? 'rotate-90' : 'rotate-0',
                )}
                strokeWidth={2.1}
              />
            </button>
          </div>
          <div className="ms-auto flex shrink-0 items-center gap-0">
            <span className="me-1 flex shrink-0 items-center">
              <span className="inline-flex items-center gap-1 text-size-chat tabular-nums tracking-tight">
                <span className="flex shrink-0 items-center ui-text-diff-add">+{props.additions}</span>
                <span className="flex shrink-0 items-center ui-text-diff-del">-{props.deletions}</span>
              </span>
            </span>
          </div>
          {props.untracked ? (
            <span data-testid="worktree-diff-untracked-indicator" className="sr-only">
              untracked
            </span>
          ) : null}
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
