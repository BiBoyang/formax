import { Check, ChevronDown, Loader2, Minus, X } from 'lucide-react'
import {
  type ButtonHTMLAttributes,
  type CSSProperties,
  type FormEvent,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react'
import { I18nProvider } from '../app/i18n/I18nProvider'
import { Button } from '../components/ui/button'
import { Card, CardContent } from '../components/ui/card'
import { cn } from '../lib/utils'

export type SetupSessionView = {
  id: string
  step: string
  error: string | null
  availableModels: string[]
  modelTier: 'haiku' | 'sonnet' | 'opus' | null
  draft: {
    provider: string | null
    anthropicVendor: string | null
    baseUrl: string
    apiKeyPresent: boolean
    modelMode: 'quick' | 'advanced'
    model: string
    tierModels: Record<'haiku' | 'sonnet' | 'opus', string>
  }
}

export type SetupAction = Record<string, unknown>

type SetupWizardScreenProps = {
  status: string
  session: SetupSessionView | null
  message: string
  apiKeyValue: string
  baseUrlValue: string
  modelValue: string
  transitionPending: boolean
  canEditConnectionFields: boolean
  canEditModelFields: boolean
  onAction: (action: SetupAction) => Promise<void>
  onTransition: (action: SetupAction) => Promise<void>
  onCommit: () => Promise<void>
  onApiKeyValueChange: (value: string) => void
  onBaseUrlValueChange: (value: string) => void
  onModelValueChange: (value: string) => void
}

export const MODEL_TIERS = ['haiku', 'sonnet', 'opus'] as const

export type SetupRestartRequiredKind = 'browser' | 'desktop'

function SetupLogo() {
  return (
    <div data-testid="setup-logo" className="mx-auto flex h-14 items-center justify-center">
      <img src="/formax-icon.svg" alt="Formax" className="h-12 w-12" draggable={false} />
    </div>
  )
}

function isMacDesktopHost(): boolean {
  if (typeof window === 'undefined' || !window.formaxDesktop) return false
  const platform = window.navigator.platform.toLowerCase()
  const userAgent = window.navigator.userAgent.toLowerCase()
  return platform.includes('mac') || userAgent.includes('mac os')
}

function SetupShell({ children }: { children: ReactNode }) {
  const desktopBridge = typeof window === 'undefined' ? undefined : window.formaxDesktop
  const showCustomWindowControls = Boolean(desktopBridge) && !isMacDesktopHost()
  const dragStyle = { WebkitAppRegion: 'drag' } as CSSProperties
  const noDragStyle = { WebkitAppRegion: 'no-drag' } as CSSProperties

  return (
    <I18nProvider language="en-US">
      <main
        data-testid="setup-compact-screen"
        className="relative flex min-h-screen w-full items-center justify-center bg-background px-5 py-5 font-sans text-foreground"
      >
        {desktopBridge ? (
          <>
            <div data-testid="setup-window-drag-region" className="absolute inset-x-0 top-0 h-10" style={dragStyle} />
            {showCustomWindowControls ? (
              <div className="absolute right-2 top-2 z-10 flex items-center gap-1" style={noDragStyle}>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Minimize"
                  onClick={() => void desktopBridge.windowControls?.minimize?.()}
                >
                  <Minus className="h-3 w-3" aria-hidden />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Close"
                  onClick={() => void desktopBridge.setup?.cancel?.()}
                >
                  <X className="h-3 w-3" aria-hidden />
                </Button>
              </div>
            ) : null}
          </>
        ) : null}
        <section className="app-shell-no-drag w-full max-w-[440px]">
          {children}
        </section>
      </main>
    </I18nProvider>
  )
}

function SetupPanel({ children }: { children: ReactNode }) {
  return (
    <Card className="w-full gap-0 overflow-hidden rounded-xl border-border/60 py-0 shadow-none">
      <CardContent className="flex flex-col divide-y divide-border/50 p-0">
        {children}
      </CardContent>
    </Card>
  )
}

function SetupRow({
  children,
  selected,
  disabled,
  className,
  ...props
}: {
  children: ReactNode
  selected?: boolean
  disabled?: boolean
  className?: string
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={cn(
        'flex min-h-11 w-full items-center justify-between px-6 py-3 text-left ui-text-base transition-colors',
        selected ? 'bg-[var(--sidebar-list-active)] text-foreground' : 'bg-card hover:bg-[var(--sidebar-list-hover)]',
        disabled && 'cursor-not-allowed opacity-55',
        className
      )}
      {...props}
    >
      {children}
      {selected ? <Check className="h-4 w-4 text-primary" aria-hidden /> : <span className="h-4 w-4" aria-hidden />}
    </button>
  )
}

function SetupFieldRow({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <label className="flex min-h-12 items-center justify-between gap-4 px-5 py-3">
      <span className="ui-text-base font-medium leading-none ui-sidebar-text-primary">{label}</span>
      <div className="w-[260px] shrink-0">{children}</div>
    </label>
  )
}

function SetupInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className="h-8 w-full rounded-md border border-transparent bg-[var(--sidebar-list-active)] px-3 py-1 ui-text-base outline-none transition-colors placeholder:text-muted-foreground hover:bg-[var(--sidebar-list-hover)] focus-visible:border-border disabled:cursor-not-allowed disabled:opacity-55"
      {...props}
    />
  )
}

function SetupSelect(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative w-full">
      <select
        className="h-8 w-full appearance-none rounded-md border border-transparent bg-[var(--sidebar-list-active)] px-3 py-1 pr-9 ui-text-base outline-none transition-colors hover:bg-[var(--sidebar-list-hover)] focus:outline-none focus:ring-0 focus:ring-transparent focus:ring-offset-0 focus-visible:border-border focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-transparent focus:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-55"
        {...props}
      />
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
    </div>
  )
}

function setupTitleForStep(step: string | null): string {
  switch (step) {
    case 'provider':
    case 'welcome':
      return 'Provider'
    case 'anthropicVendor':
      return 'Vendor'
    case 'baseUrl':
    case 'apiKey':
    case 'test':
      return 'Credentials'
    case 'modelMode':
    case 'model':
      return 'Model'
    case 'confirm':
    case 'write':
      return 'Review'
    default:
      return 'Setup'
  }
}

function setupSubtitleForStep(step: string | null): string {
  switch (step) {
    case 'provider':
    case 'welcome':
      return 'Choose the API format.'
    case 'anthropicVendor':
      return 'Choose your model provider.'
    case 'baseUrl':
    case 'apiKey':
    case 'test':
      return 'Enter your endpoint and key.'
    case 'modelMode':
    case 'model':
      return 'Choose how models are mapped.'
    case 'confirm':
    case 'write':
      return 'Confirm your setup.'
    default:
      return 'Connect Formax to your model provider.'
  }
}

function vendorLabel(value: string | null): string {
  switch (value) {
    case 'deepseek':
      return 'DeepSeek'
    case 'anthropic':
      return 'Anthropic'
    case 'glm':
      return 'GLM'
    case 'kimi':
      return 'Kimi'
    case 'minimax':
      return 'MiniMax'
    case 'custom':
      return 'Custom'
    default:
      return 'None'
  }
}

function providerLabel(value: string | null): string {
  if (value === 'openai') return 'OpenAI-compatible'
  if (value === 'anthropic') return 'Anthropic-compatible'
  return 'None'
}

export function setupModelInputValue(session: SetupSessionView): string {
  return session.draft.modelMode === 'advanced' && session.modelTier
    ? session.draft.tierModels[session.modelTier]
    : session.draft.model
}

export function SetupWizardScreen(props: SetupWizardScreenProps) {
  const step = props.session?.step ?? null
  const isWriteStep = step === 'write'
  const isAutoAdvancingWelcome = step === 'welcome'
  const title = setupTitleForStep(step)
  const subtitle = setupSubtitleForStep(step)
  const error = props.session?.error || props.message
  const canGoBack = Boolean(props.session && step !== 'provider' && step !== 'welcome')

  const advanceModelStep = async () => {
    if (!props.session) return
    if (props.session.draft.modelMode === 'quick') {
      if (props.session.step === 'modelMode') {
        await props.onTransition({ type: 'next' })
      }
      await props.onTransition({ type: 'next' })
      return
    }

    const currentTier = props.session.modelTier
    const remainingModelSteps =
      currentTier === 'opus' ? 1 :
        currentTier === 'sonnet' ? 2 :
          currentTier === 'haiku' ? 3 :
            3
    if (props.session.step === 'modelMode') {
      await props.onTransition({ type: 'next' })
    }
    for (let i = 0; i < remainingModelSteps; i += 1) {
      await props.onTransition({ type: 'next' })
    }
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (props.transitionPending) return
    if (isWriteStep) void props.onCommit()
    else if (step === 'modelMode' || step === 'model') void advanceModelStep()
    else void props.onTransition({ type: 'next' })
  }

  return (
    <SetupShell>
      <form data-testid="setup-entrypoint" onSubmit={submit}>
        <div className="flex flex-col items-center gap-4">
          <SetupLogo />
          <div className="flex flex-col items-center gap-1">
            <h1 className="text-[20px] font-bold tracking-tight">{props.session ? title : 'Setup'}</h1>
            <p className="ui-text-meta text-muted-foreground">{subtitle}</p>
          </div>
          {!props.session || isAutoAdvancingWelcome ? (
            <div className="flex min-h-[132px] w-full items-center justify-center rounded-xl border border-border/60 bg-card">
              <div className="flex items-center gap-2 ui-text-base text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                <span>{isAutoAdvancingWelcome ? 'Loading' : props.message || (props.status === 'connected' ? 'Loading' : 'Connecting')}</span>
              </div>
            </div>
          ) : (
            <SetupStepContent
              session={props.session}
              apiKeyValue={props.apiKeyValue}
              baseUrlValue={props.baseUrlValue}
              modelValue={props.modelValue}
              canEditConnectionFields={props.canEditConnectionFields}
              canEditModelFields={props.canEditModelFields}
              onAction={props.onAction}
              onApiKeyValueChange={props.onApiKeyValueChange}
              onBaseUrlValueChange={props.onBaseUrlValueChange}
              onModelValueChange={props.onModelValueChange}
            />
          )}
          {error ? (
            <div role="alert" className="w-full rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2 ui-text-meta text-destructive">
              {error}
            </div>
          ) : null}
          <div className="flex w-full items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!canGoBack || isAutoAdvancingWelcome || props.transitionPending}
              onClick={() => void props.onTransition({ type: 'back' })}
            >
              Back
            </Button>
            <Button type="submit" size="sm" disabled={!props.session || isAutoAdvancingWelcome || props.transitionPending}>
              {isWriteStep ? 'Save' : 'Next'}
            </Button>
          </div>
        </div>
      </form>
    </SetupShell>
  )
}

function SetupStepContent(props: {
  session: SetupSessionView
  apiKeyValue: string
  baseUrlValue: string
  modelValue: string
  canEditConnectionFields: boolean
  canEditModelFields: boolean
  onAction: (action: SetupAction) => Promise<void>
  onApiKeyValueChange: (value: string) => void
  onBaseUrlValueChange: (value: string) => void
  onModelValueChange: (value: string) => void
}) {
  const { session } = props

  if (session.step === 'provider' || session.step === 'welcome') {
    return (
      <SetupPanel>
        {[
          ['openai', 'OpenAI-compatible'],
          ['anthropic', 'Anthropic-compatible'],
        ].map(([provider, label]) => (
          <SetupRow
            key={provider}
            aria-label={label}
            selected={session.draft.provider === provider}
            disabled={!props.canEditConnectionFields}
            onClick={() => void props.onAction({ type: 'setProvider', provider })}
          >
            <span>{label}</span>
          </SetupRow>
        ))}
      </SetupPanel>
    )
  }

  if (session.step === 'anthropicVendor') {
    const vendors = [
      ['deepseek', 'DeepSeek'],
      ['anthropic', 'Anthropic'],
      ['glm', 'GLM'],
      ['kimi', 'Kimi'],
      ['minimax', 'MiniMax'],
      ['custom', 'Custom'],
    ]
    return (
      <SetupPanel>
        {vendors.map(([vendor, label]) => (
          <SetupRow
            key={vendor}
            aria-label={label}
            selected={(session.draft.anthropicVendor ?? 'deepseek') === vendor}
            disabled={!props.canEditConnectionFields}
            onClick={() => void props.onAction({ type: 'setAnthropicVendor', vendor })}
          >
            <span>{label}</span>
          </SetupRow>
        ))}
      </SetupPanel>
    )
  }

  if (session.step === 'baseUrl' || session.step === 'apiKey' || session.step === 'test') {
    return (
      <SetupPanel>
        <SetupFieldRow label="Base URL">
          <SetupInput
            aria-label="Base URL"
            value={props.baseUrlValue}
            disabled={!props.canEditConnectionFields}
            onChange={(event) => {
              props.onBaseUrlValueChange(event.target.value)
              void props.onAction({ type: 'setBaseUrl', baseUrl: event.target.value })
            }}
          />
        </SetupFieldRow>
        <SetupFieldRow label="API Key">
          <SetupInput
            aria-label="API key"
            type="password"
            value={props.apiKeyValue}
            placeholder={session.draft.apiKeyPresent ? 'Saved' : ''}
            disabled={!props.canEditConnectionFields}
            onChange={(event) => {
              props.onApiKeyValueChange(event.target.value)
              void props.onAction({ type: 'setApiKey', apiKey: event.target.value })
            }}
          />
        </SetupFieldRow>
      </SetupPanel>
    )
  }

  if (session.step === 'modelMode' || session.step === 'model') {
    const modelOptions = session.availableModels.length > 0 ? session.availableModels : [props.modelValue].filter(Boolean)
    const quickModelValue = props.modelValue || session.draft.model || modelOptions[0] || ''
    return (
      <SetupPanel>
        <SetupFieldRow label="Mode">
          <SetupSelect
            aria-label="Model mode"
            value={session.draft.modelMode}
            disabled={!props.canEditModelFields}
            onChange={(event) => void props.onAction({ type: 'setModelMode', mode: event.target.value })}
          >
            <option value="quick">Quick</option>
            <option value="advanced">Advanced</option>
          </SetupSelect>
        </SetupFieldRow>
        {session.draft.modelMode === 'advanced' ? (
          MODEL_TIERS.map((tier) => {
            const value = session.draft.tierModels[tier] || modelOptions[0] || ''
            return (
              <SetupFieldRow key={tier} label={`${tier[0].toUpperCase()}${tier.slice(1)}`}>
                <SetupSelect
                  aria-label={`${tier} model`}
                  value={value}
                  disabled={!props.canEditModelFields}
                  onChange={(event) => void props.onAction({ type: 'setTierModel', tier, model: event.target.value })}
                >
                  {modelOptions.map((model) => <option key={model} value={model}>{model}</option>)}
                </SetupSelect>
              </SetupFieldRow>
            )
          })
        ) : (
          <SetupFieldRow label="Model">
            <SetupSelect
              aria-label="Model"
              value={quickModelValue}
              disabled={!props.canEditModelFields}
              onChange={(event) => {
                props.onModelValueChange(event.target.value)
                void props.onAction({ type: 'setModel', model: event.target.value })
              }}
            >
              {modelOptions.map((model) => <option key={model} value={model}>{model}</option>)}
            </SetupSelect>
          </SetupFieldRow>
        )}
      </SetupPanel>
    )
  }

  return (
    <SetupPanel>
      <SetupSummaryRow label="Provider" value={providerLabel(session.draft.provider)} />
      <SetupSummaryRow label="Vendor" value={session.draft.provider === 'anthropic' ? vendorLabel(session.draft.anthropicVendor) : 'OpenAI'} />
      <SetupSummaryRow label="Base URL" value={session.draft.baseUrl || 'None'} />
      <SetupSummaryRow label="API Key" value={session.draft.apiKeyPresent ? 'Saved' : 'None'} />
      <SetupSummaryRow label="Model" value={setupModelInputValue(session) || 'None'} />
    </SetupPanel>
  )
}

function SetupSummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-4 px-5 py-3">
      <span className="ui-text-base font-medium leading-none ui-sidebar-text-primary">{label}</span>
      <span className="max-w-[260px] truncate text-right ui-text-base text-muted-foreground">{value}</span>
    </div>
  )
}

export function SetupRestartRequired(props: { kind: SetupRestartRequiredKind }) {
  const message =
    props.kind === 'desktop'
      ? 'Restart desktop runtime'
      : 'Restart the web server, then refresh this page.'
  return (
    <SetupShell>
      <div data-testid="setup-restart-required" className="flex flex-col items-center gap-4">
        <SetupLogo />
        <h1 className="text-[20px] font-bold tracking-tight">Setup complete</h1>
        <SetupPanel>
          <div className="flex min-h-11 items-center justify-between gap-4 px-5 py-3">
            <span className="ui-text-base font-medium leading-none ui-sidebar-text-primary">Status</span>
            <span role="alert" className="text-right ui-text-base text-muted-foreground">{message}</span>
          </div>
        </SetupPanel>
      </div>
    </SetupShell>
  )
}
