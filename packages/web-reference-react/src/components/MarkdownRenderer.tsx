import type { HTMLAttributes } from 'react'
import type { CodexMarkdownProps } from '../codex-md'
import { CodexMarkdown } from '../codex-md'
import { cn } from '../lib/utils'

type MarkdownRendererProps = Omit<HTMLAttributes<HTMLDivElement>, 'dangerouslySetInnerHTML' | 'children'> & {
  text: string
  cacheKey?: string
  cwd?: string
  onOpenFile?: CodexMarkdownProps['onOpenFile']
  onExternalLinkClick?: CodexMarkdownProps['onExternalLinkClick']
}

export function MarkdownRenderer({
  text,
  cacheKey: _cacheKey,
  cwd,
  onOpenFile,
  onExternalLinkClick,
  className,
  ...rest
}: MarkdownRendererProps) {
  return (
    <div className={cn('codex-md-host min-w-0', className)} data-codex-window-type="electron" {...rest}>
      <CodexMarkdown cwd={cwd} onExternalLinkClick={onExternalLinkClick} onOpenFile={onOpenFile} value={text} />
    </div>
  )
}
