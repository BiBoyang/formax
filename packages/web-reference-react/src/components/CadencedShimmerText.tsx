import { cn } from '../lib/utils'

export function CadencedShimmerText(props: {
  text: string
  active?: boolean
  className?: string
}) {
  const { text, active = false, className } = props
  return (
    <span
      className={cn('cadenced-shimmer', className)}
      data-active={active ? 'true' : undefined}
    >
      <span className="cadenced-shimmer-base">{text}</span>
      {active ? (
        <span key={text} aria-hidden="true" className="cadenced-shimmer-sweep" data-text={text} />
      ) : null}
    </span>
  )
}
