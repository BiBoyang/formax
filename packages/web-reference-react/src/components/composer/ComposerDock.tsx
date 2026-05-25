import { ArrowDown, ArrowUp, ChevronsRight, Pause, Pencil, Square } from 'lucide-react'
import { memo, useState, type FormEvent, type ReactNode } from 'react'
import { shouldTreatAsLongPrompt } from '../../app/core/userSettings'
import { useI18n, type I18nTranslator } from '../../app/i18n/I18nProvider'
import { cn } from '../../lib/utils'
import type { ContextMeterView } from '../../types'
import { Button } from '../ui/button'
import { Textarea } from '../ui/textarea'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip'
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

function formatTokensK(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '0k'
  if (value < 1000) return String(Math.max(0, Math.floor(value)))
  const inK = value / 1000
  const oneDecimal = Math.round(inK * 10) / 10
  return Number.isInteger(oneDecimal) ? `${oneDecimal}k` : `${oneDecimal.toFixed(1)}k`
}

export function ComposerContextMeterRing(props: {
  activeContextMeter?: ContextMeterView
  showContextMeter?: boolean
  className?: string
}) {
  const { t } = useI18n()
  const showContextRing = Boolean(props.showContextMeter && props.activeContextMeter?.available && props.activeContextMeter?.label)
  if (!showContextRing) return null
  const meterPercent = Math.max(0, Math.min(100, Math.round(props.activeContextMeter?.percentUsed ?? 0)))
  const meterRemainingPercent = Math.max(0, Math.min(100, Math.round(props.activeContextMeter?.percentRemaining ?? 0)))
  const meterUsedTokensK = formatTokensK(props.activeContextMeter?.usedTokens)
  const meterLimitTokensK = formatTokensK(props.activeContextMeter?.limitTokens)

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            data-testid="composer-context-meter-ring"
            className={cn('inline-flex h-3 w-3 items-center justify-center rounded-full', props.className)}
            aria-label={props.activeContextMeter?.label ?? undefined}
            style={{
              background: `conic-gradient(#6b7280 ${meterPercent}%, #d1d5db ${meterPercent}% 100%)`,
            }}
          >
            <div className="h-[7px] w-[7px] rounded-full bg-card" />
          </div>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[260px] text-[13px] leading-relaxed">
          <div className="font-medium">{t('transcript.contextMeterTooltip.title')}</div>
          <div>{t('transcript.contextMeterTooltip.percentLine', { used: String(meterPercent), remaining: String(meterRemainingPercent) })}</div>
          <div>{t('transcript.contextMeterTooltip.tokenLine', { used: meterUsedTokensK, total: meterLimitTokensK })}</div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export type ComposerDockProps = {
  showJumpToBottom: boolean
  onJumpToBottom: () => void
  inputText: string
  onInputTextChange: (value: string) => void
  mode: ComposerMode
  onModeChange: (value: ComposerMode) => void
  connectionStatus: 'disconnected' | 'connecting' | 'connected'
  canSubmit: boolean
  isInputDisabled?: boolean
  showInterrupt?: boolean
  isSending: boolean
  isInterrupting: boolean
  onInterrupt: () => void
  onSend: (event: FormEvent) => void
  longTextRequireCmdEnter: boolean
  placeholder?: string
  layoutVariant?: 'bottom' | 'centered'
  footerAccessory?: ReactNode
  floatingFooterAccessory?: ReactNode
  activeContextMeter?: ContextMeterView
  showContextMeter?: boolean
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
    closeSlashMenu,
  } = useSlashCommandState({
    inputText: props.inputText,
    onInputTextChange: props.onInputTextChange,
  })

  return (
    <div
      data-testid="composer"
      data-layout-variant={props.layoutVariant ?? 'bottom'}
      className={cn('composer', props.layoutVariant === 'centered' ? 'w-full' : 'px-4 pb-8')}
    >
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
          className="group relative z-10 flex flex-col overflow-hidden rounded-[24px] border border-border/85 bg-card/95 shadow-sm transition-all duration-200 focus-within:border-ring/30 focus-within:shadow-md"
          onSubmit={props.onSend}
        >
          <Textarea
            value={props.inputText}
            onChange={(event) => props.onInputTextChange(event.target.value)}
            placeholder={props.placeholder ?? t('transcript.followUpPlaceholder')}
            disabled={props.isInputDisabled}
            className="composer-input min-h-[72px] max-h-[300px] w-full resize-none border-none bg-transparent px-3 pt-3 pb-2 ui-text-base leading-relaxed focus-visible:ring-0 shadow-none"
            onCompositionStart={() => setIsImeComposing(true)}
            onCompositionEnd={() => setIsImeComposing(false)}
            onKeyDown={(event) => {
              if (props.isInputDisabled) return
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
              if (props.canSubmit && !props.isSending) {
                props.onSend(event as unknown as FormEvent)
              }
            }}
          />

          <div className="flex items-center justify-between px-3 pb-2 pt-1">
            <div className="flex min-w-0 items-center gap-2.5">
              <Button
                type="button"
                variant="ghost"
                aria-label={t('transcript.executionMode')}
                onClick={() => props.onModeChange(nextComposerMode(props.mode))}
                className={cn('h-6 gap-1 rounded-md px-1.5 py-0 has-[>svg]:px-1.5 ui-text-meta font-normal transition-colors', modeInfo.toneClass)}
                title={t('transcript.modeCycleTitle')}
              >
                <modeInfo.icon className="size-3 shrink-0" />
                <span>{modeInfo.label}</span>
              </Button>
            </div>
            <div className="flex items-center gap-1 pr-1 text-muted-foreground">
              <ComposerContextMeterRing
                activeContextMeter={props.activeContextMeter}
                showContextMeter={props.showContextMeter}
                className="mr-2"
              />
              {props.showInterrupt || props.isInterrupting ? (
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
                  disabled={!props.canSubmit}
                  size="icon"
                  className={cn(
                    'h-7 w-7 rounded-full shrink-0 border-0 shadow-none transition-colors duration-150 disabled:opacity-100',
                    !props.canSubmit ? 'ui-button-disabled text-white hover:ui-button-disabled' : 'bg-black text-white hover:bg-black/90',
                  )}
                >
                  <ArrowUp className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </form>
        {props.floatingFooterAccessory ? (
          <div className="pointer-events-none absolute inset-x-0 top-full z-0 h-10">
            <div className="absolute inset-x-0 -top-6 h-16 rounded-b-[24px] bg-muted shadow-[0_2px_8px_rgba(0,0,0,0.05)]" />
            <div className="pointer-events-auto relative flex h-10 items-center px-4">
              {props.floatingFooterAccessory}
            </div>
          </div>
        ) : null}
        {props.footerAccessory ? <div className="mt-3">{props.footerAccessory}</div> : null}
      </div>
    </div>
  )
})
