import { ArrowDown, ArrowUp, ChevronsRight, Pause, Pencil, Square } from 'lucide-react'
import { memo, useState, type FormEvent } from 'react'
import { shouldTreatAsLongPrompt } from '../../app/core/userSettings'
import { useI18n, type I18nTranslator } from '../../app/i18n/I18nProvider'
import { cn } from '../../lib/utils'
import { Button } from '../ui/button'
import { Textarea } from '../ui/textarea'
import { SlashCommandMenu } from './SlashCommandMenu'
import { useSlashCommandState } from './useSlashCommandState'

type ComposerMode = 'normal' | 'acceptEdits' | 'plan'

const MODE_CYCLE: ComposerMode[] = ['normal', 'acceptEdits', 'plan']

function nextComposerMode(mode: ComposerMode): ComposerMode {
  const idx = MODE_CYCLE.indexOf(mode)
  if (idx < 0) return 'normal'
  return MODE_CYCLE[(idx + 1) % MODE_CYCLE.length] ?? 'normal'
}

function modeMeta(mode: ComposerMode, t: I18nTranslator): { label: string; icon: typeof Pencil; toneClass: string } {
  if (mode === 'plan') {
    return {
      label: t('transcript.mode.plan'),
      icon: Pause,
      toneClass: 'text-foreground/70 hover:text-foreground',
    }
  }
  if (mode === 'acceptEdits') {
    return {
      label: t('transcript.mode.acceptEdits'),
      icon: ChevronsRight,
      toneClass: 'text-foreground/70 hover:text-foreground',
    }
  }
  return {
    label: t('transcript.mode.normal'),
    icon: Pencil,
    toneClass: 'text-foreground/70 hover:text-foreground',
  }
}

export type ComposerDockProps = {
  showJumpToBottom: boolean
  onJumpToBottom: () => void
  inputText: string
  onInputTextChange: (value: string) => void
  mode: ComposerMode
  onModeChange: (value: ComposerMode) => void
  activeThreadId: string | null
  connectionStatus: 'disconnected' | 'connecting' | 'connected'
  isSending: boolean
  isInterrupting: boolean
  onInterrupt: () => void
  onSend: (event: FormEvent) => void
  longTextRequireCmdEnter: boolean
}

export const ComposerDock = memo(function ComposerDock(props: ComposerDockProps) {
  const { t } = useI18n()
  const [isImeComposing, setIsImeComposing] = useState(false)
  const modeInfo = modeMeta(props.mode, t)

  const {
    composerRootRef,
    slashQuery,
    slashCommandSpecs,
    isSlashMenuVisible,
    slashSelectionIndex,
    setSlashSelectionIndex,
    applySlashCommandSelection,
    toggleSlashMenu,
    closeSlashMenu,
  } = useSlashCommandState({
    inputText: props.inputText,
    onInputTextChange: props.onInputTextChange,
  })

  return (
    <div data-testid="composer" className="composer p-4 pb-8">
      <div ref={composerRootRef} className="max-w-3xl mx-auto relative">
        {props.showJumpToBottom ? (
          <div className="pointer-events-none absolute left-1/2 -top-12 z-10 -translate-x-1/2">
            <Button
              type="button"
              aria-label={t('transcript.jumpToBottom')}
              size="icon"
              variant="outline"
              className="pointer-events-auto h-9 w-9 rounded-full border-border/70 bg-background/95 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-background/80"
              onClick={props.onJumpToBottom}
            >
              <ArrowDown className="h-4 w-4" />
            </Button>
          </div>
        ) : null}
        {isSlashMenuVisible ? (
          <SlashCommandMenu
            slashQuery={slashQuery}
            slashCommandSpecs={slashCommandSpecs}
            slashSelectionIndex={slashSelectionIndex}
            onSelectionIndexChange={setSlashSelectionIndex}
            onSelectCommand={applySlashCommandSelection}
          />
        ) : null}
        <form
          className="group relative flex flex-col overflow-hidden rounded-[24px] border border-border/85 bg-card/95 shadow-sm focus-within:border-ring/30 focus-within:shadow-md transition-all duration-200"
          onSubmit={props.onSend}
        >
          <Textarea
            value={props.inputText}
            onChange={(event) => props.onInputTextChange(event.target.value)}
            placeholder={t('transcript.followUpPlaceholder')}
            className="min-h-[72px] max-h-[300px] w-full resize-none border-none bg-transparent px-5 pt-2 pb-1 ui-text-base leading-relaxed placeholder:text-muted-foreground/55 focus-visible:ring-0 shadow-none"
            onCompositionStart={() => setIsImeComposing(true)}
            onCompositionEnd={() => setIsImeComposing(false)}
            onKeyDown={(event) => {
              if (event.key === 'Tab' && event.shiftKey) {
                event.preventDefault()
                props.onModeChange(nextComposerMode(props.mode))
                return
              }
              if (isSlashMenuVisible && slashCommandSpecs.length > 0) {
                if (event.key === 'ArrowDown') {
                  event.preventDefault()
                  setSlashSelectionIndex((previous) => (previous + 1) % slashCommandSpecs.length)
                  return
                }
                if (event.key === 'ArrowUp') {
                  event.preventDefault()
                  setSlashSelectionIndex((previous) => (previous + slashCommandSpecs.length - 1) % slashCommandSpecs.length)
                  return
                }
                if (event.key === 'Tab') {
                  event.preventDefault()
                  const selected = slashCommandSpecs[slashSelectionIndex] ?? slashCommandSpecs[0]
                  if (selected) {
                    applySlashCommandSelection(selected.command)
                  }
                  return
                }
              }
              if (event.key === 'Escape' && isSlashMenuVisible) {
                event.preventDefault()
                closeSlashMenu()
                return
              }
              if (event.key !== 'Enter' || event.shiftKey) return
              const nativeEvent = event.nativeEvent as KeyboardEvent
              if (isImeComposing || nativeEvent.isComposing || nativeEvent.keyCode === 229) return
              if (
                props.longTextRequireCmdEnter === true &&
                shouldTreatAsLongPrompt(props.inputText) &&
                !nativeEvent.metaKey &&
                !nativeEvent.ctrlKey
              ) {
                return
              }
              event.preventDefault()
              if (props.activeThreadId && props.connectionStatus === 'connected' && !props.inputText.trim()) return
              if (props.activeThreadId && props.connectionStatus === 'connected' && !props.isSending) {
                props.onSend(event as unknown as FormEvent)
              }
            }}
          />

          <div className="flex items-center justify-between px-3 py-2">
            <div className="flex min-w-0 items-center gap-2.5">
              <Button
                type="button"
                variant="ghost"
                aria-label={t('transcript.openSlashCommands')}
                aria-expanded={isSlashMenuVisible}
                data-testid="composer-slash-trigger"
                onClick={toggleSlashMenu}
                className={cn(
                  'h-7 rounded-md px-2 font-mono text-[13px] leading-none tracking-tight text-muted-foreground transition-colors hover:text-foreground',
                  isSlashMenuVisible && 'bg-muted text-foreground',
                )}
                title={t('transcript.slashCommandsTitle')}
              >
                /
              </Button>
              <Button
                type="button"
                variant="ghost"
                aria-label={t('transcript.executionMode')}
                onClick={() => props.onModeChange(nextComposerMode(props.mode))}
                className={cn('h-7 rounded-md px-2 ui-text-base font-medium tracking-tight transition-colors', modeInfo.toneClass)}
                title={t('transcript.modeCycleTitle')}
              >
                <modeInfo.icon className="mr-0.5 size-3 shrink-0" />
                <span>{modeInfo.label}</span>
              </Button>
              <div className="hidden lg:block ui-text-base text-muted-foreground/85">
                {t('transcript.modeCycleHint')}
              </div>
            </div>
            <div className="flex items-center gap-1 pr-1 text-muted-foreground">
              {props.isSending || props.isInterrupting ? (
                <Button
                  type="button"
                  aria-label={t('transcript.interruptTurn')}
                  size="icon"
                  disabled={props.isInterrupting}
                  className="h-7 w-7 rounded-full shrink-0 border-0 bg-black text-white shadow-none hover:bg-black/90"
                  onClick={props.onInterrupt}
                >
                  <Square className="size-3 fill-current" />
                </Button>
              ) : (
                <Button
                  type="submit"
                  aria-label={t('transcript.sendMessage')}
                  disabled={!props.activeThreadId || props.connectionStatus !== 'connected' || !props.inputText.trim()}
                  size="icon"
                  className={cn(
                    'h-7 w-7 rounded-full shrink-0 border-0 shadow-none transition-colors duration-150 disabled:opacity-100',
                    !props.inputText.trim() ? 'ui-button-disabled text-white hover:ui-button-disabled' : 'bg-black text-white hover:bg-black/90',
                  )}
                >
                  <ArrowUp className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
  )
})
