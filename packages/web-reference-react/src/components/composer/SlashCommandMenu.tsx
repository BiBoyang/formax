import type { WebSupportedSlashCommandSpec } from '../../app/core/commandSupport'
import { useI18n } from '../../app/i18n/I18nProvider'
import { cn } from '../../lib/utils'

type SlashCommandMenuProps = {
  slashQuery: string | null
  slashCommandSpecs: readonly WebSupportedSlashCommandSpec[]
  slashSelectionIndex: number
  onSelectionIndexChange: (index: number) => void
  onSelectCommand: (command: string) => void
}

export function SlashCommandMenu(props: SlashCommandMenuProps) {
  const { t } = useI18n()

  return (
    <div
      data-testid="composer-slash-menu"
      className="absolute inset-x-2 bottom-[calc(100%+0.5rem)] z-30 overflow-hidden rounded-2xl border border-border/80 bg-background/96 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/88"
    >
      <div className="px-3 py-2 border-b border-border/70 ui-text-meta text-muted-foreground">
        {props.slashQuery == null ? t('transcript.webSlashCommands') : t('transcript.slashFilter', { query: props.slashQuery })}
      </div>
      <div className="max-h-64 overflow-y-auto px-1 py-1.5">
        {props.slashCommandSpecs.length === 0 ? (
          <div className="rounded-lg px-2 py-2 ui-text-meta text-muted-foreground">
            {t('transcript.noMatchingSlashCommand')}
          </div>
        ) : (
          props.slashCommandSpecs.map((spec, index) => (
            <button
              key={spec.command}
              type="button"
              aria-label={t('transcript.insertSlashCommand', { command: spec.command })}
              className={cn(
                'flex w-full items-start justify-between gap-3 rounded-xl px-2.5 py-2 text-left transition-colors',
                index === props.slashSelectionIndex ? 'bg-muted/70 text-foreground' : 'text-foreground/92 hover:bg-muted/55',
              )}
              onMouseDown={(event) => {
                event.preventDefault()
              }}
              onMouseEnter={() => {
                props.onSelectionIndexChange(index)
              }}
              onClick={() => {
                props.onSelectCommand(spec.command)
              }}
            >
              <span className="font-mono text-[13px] leading-5">{spec.command}</span>
              <span className="ui-text-meta text-muted-foreground text-right">{spec.description}</span>
            </button>
          ))
        )}
      </div>
    </div>
  )
}
