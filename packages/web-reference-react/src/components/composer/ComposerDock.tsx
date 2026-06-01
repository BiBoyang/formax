import { ArrowDown, ArrowUp, Brain, Check, ChevronDown, ChevronsRight, Pause, Pencil, Square } from 'lucide-react'
import { memo, useState, type FormEvent, type ReactNode } from 'react'
import { shouldTreatAsLongPrompt } from '../../app/core/userSettings'
import { useI18n, type I18nTranslator } from '../../app/i18n/I18nProvider'
import { cn } from '../../lib/utils'
import type { ContextMeterView } from '../../types'
import { RUNTIME_THINKING_EFFORTS, type RuntimeModelTier, type RuntimeThinkingEffort } from '../../app/runtime/runtimePreferences'
import { Button } from '../ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import { Textarea } from '../ui/textarea'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip'
import { SlashCommandMenu } from './SlashCommandMenu'
import { useSlashCommandState } from './useSlashCommandState'

type ComposerMode = 'normal' | 'acceptEdits' | 'plan'
type ComposerModelTier = RuntimeModelTier
type ComposerThinkingEffort = RuntimeThinkingEffort

const MODE_CYCLE: ComposerMode[] = ['normal', 'acceptEdits', 'plan']
const COMPOSER_MODE_OPTIONS: ComposerMode[] = ['plan', 'acceptEdits', 'normal']
const COMPOSER_MODEL_TIERS: ComposerModelTier[] = ['haiku', 'sonnet', 'opus']
const COMPOSER_THINKING_EFFORTS: ComposerThinkingEffort[] = RUNTIME_THINKING_EFFORTS

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

function thinkingEffortLabel(effort: ComposerThinkingEffort, t: I18nTranslator): string {
  return t(`transcript.thinkingEffort.${effort}` as const)
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
  modelTier: ComposerModelTier
  thinkingMode: boolean
  thinkingEffort: ComposerThinkingEffort
  thinkingEffortSupported: boolean
  onModeChange: (value: ComposerMode) => void
  onModelTierChange: (value: ComposerModelTier) => void
  onThinkingModeChange: (value: boolean) => void
  onThinkingEffortChange: (value: ComposerThinkingEffort) => void
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
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false)
  const [isThinkingEffortMenuOpen, setIsThinkingEffortMenuOpen] = useState(false)
  const modeInfo = modeMeta(props.mode, t)
  const thinkingLabel =
    props.thinkingEffortSupported && props.thinkingMode
      ? thinkingEffortLabel(props.thinkingEffort, t)
      : props.thinkingMode
        ? t('transcript.thinkingMode.on')
        : t('transcript.thinkingMode.off')
  const openThinkingEffortMenu = () => {
    setIsModelMenuOpen(false)
    setIsThinkingEffortMenuOpen(true)
  }
  const openModelMenu = () => {
    setIsThinkingEffortMenuOpen(false)
    setIsModelMenuOpen(true)
  }
  const handleThinkingEffortMenuOpenChange = (open: boolean) => {
    setIsThinkingEffortMenuOpen(open)
    if (open) setIsModelMenuOpen(false)
  }
  const handleModelMenuOpenChange = (open: boolean) => {
    setIsModelMenuOpen(open)
    if (open) setIsThinkingEffortMenuOpen(false)
  }

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
      <div ref={composerRootRef} className="relative mx-auto max-w-[var(--composer-dock-max-width)]">
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
          className="ui-composer-surface group relative z-10 flex flex-col overflow-hidden transition-all duration-200"
          onSubmit={props.onSend}
        >
          <div className="px-2 py-1.5" aria-hidden />
          <Textarea
            value={props.inputText}
            onChange={(event) => props.onInputTextChange(event.target.value)}
            placeholder={props.placeholder ?? t('transcript.followUpPlaceholder')}
            disabled={props.isInputDisabled}
            className="composer-input min-h-[var(--composer-input-min-height)] max-h-[300px] w-full resize-none border-none bg-transparent px-3 pb-1 pt-0 ui-text-base leading-relaxed focus-visible:ring-0 shadow-none"
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

          <div className="mb-2 grid min-h-[var(--composer-toolbar-height)] grid-cols-[minmax(0,auto)_auto_minmax(0,1fr)] items-center gap-[5px] px-2 pt-1">
            <div className="flex min-w-0 items-center gap-[5px]">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    aria-label={t('transcript.executionMode')}
                    className={cn('ui-composer-toolbar-pill has-[>svg]:px-[var(--composer-toolbar-pill-padding-x)] transition-colors', modeInfo.toneClass)}
                    title={t('transcript.modeCycleTitle')}
                  >
                    <modeInfo.icon className="size-3 shrink-0" />
                    <span>{modeInfo.label}</span>
                    <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  side="top"
                  align="start"
                  sideOffset={8}
                  className="ui-menu-content w-[var(--composer-menu-width)] p-1"
                >
                  {COMPOSER_MODE_OPTIONS.map((mode) => {
                    const optionInfo = modeMeta(mode, t)
                    return (
                      <DropdownMenuItem
                        key={mode}
                        className="ui-composer-menu-item ui-text-base"
                        onSelect={() => props.onModeChange(mode)}
                      >
                        <optionInfo.icon className="size-3.5 shrink-0 text-muted-foreground" />
                        <span>{optionInfo.label}</span>
                        {props.mode === mode ? <Check className="ui-menu-trailing-icon ml-auto text-foreground/70" /> : null}
                      </DropdownMenuItem>
                    )
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <div className="flex items-center" />
            <div className="flex min-w-0 items-center justify-end gap-2 text-muted-foreground">
              <div className="flex min-w-0 flex-1 justify-end">
                <ComposerContextMeterRing
                  activeContextMeter={props.activeContextMeter}
                  showContextMeter={props.showContextMeter}
                />
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <DropdownMenu onOpenChange={(open) => {
                  if (!open) {
                    setIsModelMenuOpen(false)
                    setIsThinkingEffortMenuOpen(false)
                  }
                }}>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      aria-label={t('transcript.modelSelector')}
                      className="ui-composer-toolbar-pill text-foreground/80 transition-colors"
                    >
                      <span>{props.modelTier}</span>
                      <span className="text-muted-foreground">{thinkingLabel}</span>
                      <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    side="top"
                    align="end"
                    sideOffset={8}
                    className="ui-menu-content w-[var(--composer-menu-width)] p-1"
                  >
                    <DropdownMenuLabel className="ui-menu-label px-2 pb-1 pt-1.5 ui-text-base text-muted-foreground">
                      {t('transcript.thinkingMode.section')}
                    </DropdownMenuLabel>
                    {[true, false].map((thinkingMode) => (
                      <DropdownMenuItem
                        key={String(thinkingMode)}
                        className="ui-composer-menu-item ui-text-base"
                        onSelect={() => props.onThinkingModeChange(thinkingMode)}
                      >
                        <Brain className="size-3.5 shrink-0 text-muted-foreground" />
                        <span>{thinkingMode ? t('transcript.thinkingMode.on') : t('transcript.thinkingMode.off')}</span>
                        {props.thinkingMode === thinkingMode ? <Check className="ui-menu-trailing-icon ml-auto text-foreground/70" /> : null}
                      </DropdownMenuItem>
                    ))}
                    {props.thinkingEffortSupported ? (
                      <DropdownMenuSub open={isThinkingEffortMenuOpen} onOpenChange={handleThinkingEffortMenuOpenChange}>
                        <DropdownMenuSubTrigger
                          className="ui-composer-menu-item ui-text-base"
                          onClick={(event) => {
                            event.preventDefault()
                            openThinkingEffortMenu()
                          }}
                          onPointerDown={(event) => {
                            event.preventDefault()
                            openThinkingEffortMenu()
                          }}
                          onSelect={(event) => event.preventDefault()}
                          onKeyDown={(event) => {
                            if (event.key !== 'Enter' && event.key !== ' ') return
                            event.preventDefault()
                            openThinkingEffortMenu()
                          }}
                        >
                          <span>{thinkingEffortLabel(props.thinkingEffort, t)}</span>
                        </DropdownMenuSubTrigger>
                        <DropdownMenuSubContent
                          sideOffset={8}
                          alignOffset={-4}
                          className="ui-menu-content w-[var(--composer-menu-width)] p-1"
                        >
                          <DropdownMenuLabel className="ui-menu-label px-2 pb-1 pt-1.5 ui-text-base text-muted-foreground">
                            {t('transcript.thinkingEffort.section')}
                          </DropdownMenuLabel>
                          {COMPOSER_THINKING_EFFORTS.map((thinkingEffort) => (
                            <DropdownMenuItem
                              key={thinkingEffort}
                              className="ui-composer-menu-item ui-text-base"
                              onSelect={() => props.onThinkingEffortChange(thinkingEffort)}
                            >
                              <Brain className="size-3.5 shrink-0 text-muted-foreground" />
                              <span>{thinkingEffortLabel(thinkingEffort, t)}</span>
                              {props.thinkingEffort === thinkingEffort ? <Check className="ui-menu-trailing-icon ml-auto text-foreground/70" /> : null}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>
                    ) : null}
                    <DropdownMenuSub open={isModelMenuOpen} onOpenChange={handleModelMenuOpenChange}>
                      <DropdownMenuSubTrigger
                        className="ui-composer-menu-item ui-text-base"
                        onClick={(event) => {
                          event.preventDefault()
                          openModelMenu()
                        }}
                        onPointerDown={(event) => {
                          event.preventDefault()
                          openModelMenu()
                        }}
                        onSelect={(event) => event.preventDefault()}
                        onKeyDown={(event) => {
                          if (event.key !== 'Enter' && event.key !== ' ') return
                          event.preventDefault()
                          openModelMenu()
                        }}
                      >
                        <span>{props.modelTier}</span>
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent
                        sideOffset={8}
                        alignOffset={-4}
                        className="ui-menu-content w-[var(--composer-menu-width)] p-1"
                      >
                        <DropdownMenuLabel className="ui-menu-label px-2 pb-1 pt-1.5 ui-text-base text-muted-foreground">
                          {t('transcript.modelSection')}
                        </DropdownMenuLabel>
                        {COMPOSER_MODEL_TIERS.map((tier) => (
                          <DropdownMenuItem
                            key={tier}
                            className="ui-composer-menu-item ui-text-base"
                            onSelect={() => props.onModelTierChange(tier)}
                          >
                            <span>{tier}</span>
                            {props.modelTier === tier ? <Check className="ui-menu-trailing-icon ml-auto text-foreground/70" /> : null}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  </DropdownMenuContent>
                </DropdownMenu>
                {props.showInterrupt || props.isInterrupting ? (
                  <Button
                    type="button"
                    aria-label={t('transcript.interruptTurn')}
                    size="icon"
                    disabled={props.isInterrupting}
                    className="h-7 w-7 shrink-0 rounded-full border-0 bg-black text-white shadow-none hover:bg-black/90"
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
                      'h-7 w-7 shrink-0 rounded-full border-0 shadow-none transition-colors duration-150 disabled:opacity-100',
                      !props.canSubmit ? 'ui-button-disabled text-white hover:ui-button-disabled' : 'bg-black text-white hover:bg-black/90',
                    )}
                  >
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          </div>
        </form>
        {props.floatingFooterAccessory ? (
          <div className="pointer-events-none absolute inset-x-0 top-full z-0 h-10">
            <div className="absolute inset-x-0 -top-6 h-16 rounded-b-[var(--composer-dock-radius)] bg-muted shadow-[0_2px_8px_rgba(0,0,0,0.05)]" />
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
