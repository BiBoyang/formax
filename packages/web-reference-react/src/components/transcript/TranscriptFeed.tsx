import { memo } from 'react'
import type { ReactNode } from 'react'
import { FolderSearch } from 'lucide-react'
import { Button } from '../ui/button'
import { ScrollArea } from '../ui/scroll-area'
import { LoadingStatusLine } from '../LoadingStatusLine'
import { cn } from '../../lib/utils'
import { Card } from '../ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible'
import { useI18n } from '../../app/i18n/I18nProvider'

type RpcErrorLike = {
  at: string
  method: string
  message: string
  code?: number
  data?: unknown
}

type WelcomePromptIdea = {
  icon: string
  text: string
}

// Temporarily disabled in web: welcome prompt ideas are not ready yet.
const WELCOME_PROMPT_IDEAS: WelcomePromptIdea[] = [
  // {
  //   icon: '🎮',
  //   text: 'Build a classic Snake game in this repo.',
  // },
  // {
  //   icon: '📄',
  //   text: 'Create a one-page $pdf that summarizes this app.',
  // },
  // {
  //   icon: '✏️',
  //   text: 'Create a plan to...',
  // },
]

function WelcomePromptCard(props: WelcomePromptIdea) {
  return (
    <button
      type="button"
      className="w-full min-h-[118px] rounded-[24px] border border-border/70 bg-background/58 px-4 py-4 text-left shadow-[0_1px_2px_hsl(var(--foreground)/0.02)] transition-colors hover:bg-background/74"
    >
      <span aria-hidden className="inline-flex h-5 w-5 items-center justify-center text-base leading-none">
        {props.icon}
      </span>
      <p className="mt-3 ui-text-base leading-relaxed font-medium text-foreground/90">{props.text}</p>
    </button>
  )
}

function WelcomeCanvas() {
  const { t } = useI18n()
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-1 items-center justify-center pb-8">
        <div className="text-center">
          <div className="text-2xl leading-tight font-semibold tracking-tight text-foreground/72">{t('transcript.welcomeTitle')}</div>
        </div>
      </div>

      <div className="w-full pb-1">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {WELCOME_PROMPT_IDEAS.map((idea) => (
            <WelcomePromptCard key={idea.text} {...idea} />
          ))}
        </div>
      </div>
    </div>
  )
}

export type TranscriptFeedProps = {
  isWelcomeState: boolean
  historyMore: boolean
  historyLoading: boolean
  onLoadEarlier: () => void
  hiddenInMemoryCount: number
  onRenderEarlierMessages: () => void
  renderedLogsCount: number
  rowsContent: ReactNode
  showTurnLoading: boolean
  lastRpcError: RpcErrorLike | null
  lastRpcErrorDetails: string
  showErrorDetails: boolean
  onShowErrorDetailsChange: (open: boolean) => void
  scrollAreaRef: { current: HTMLDivElement | null }
  bottomRef: { current: HTMLDivElement | null }
}

export const TranscriptFeed = memo(function TranscriptFeed(props: TranscriptFeedProps) {
  const { t } = useI18n()

  const showStaticWelcomeLayout =
    props.isWelcomeState &&
    props.renderedLogsCount === 0 &&
    !props.historyMore &&
    props.hiddenInMemoryCount === 0 &&
    !props.showTurnLoading &&
    props.lastRpcError == null

  if (showStaticWelcomeLayout) {
    return (
      <section className="transcript flex-1 min-h-0 overflow-hidden relative">
        <div className="h-full w-full px-8 pt-8">
          <div className="h-full max-w-3xl mx-auto">
            <WelcomeCanvas />
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="transcript flex-1 overflow-hidden relative">
      <ScrollArea ref={props.scrollAreaRef} className="h-full app-scroll-fade-mask-top">
        <div
          className={cn(
            'flex min-w-0 flex-col gap-4 py-8 pb-14 w-full',
            props.isWelcomeState && props.renderedLogsCount === 0 ? 'px-8 lg:px-10 max-w-none' : 'px-8 max-w-3xl mx-auto',
          )}
        >
          {props.historyMore ? (
            <div className="flex justify-center">
              <Button type="button" variant="ghost" size="sm" disabled={props.historyLoading} onClick={props.onLoadEarlier}>
                {props.historyLoading ? t('transcript.loadingEarlierMessages') : t('transcript.loadEarlierMessages')}
              </Button>
            </div>
          ) : null}

          {props.hiddenInMemoryCount > 0 ? (
            <div className="flex justify-center">
              <Button type="button" variant="ghost" size="sm" onClick={props.onRenderEarlierMessages}>
                {t('transcript.renderEarlierMessages', { count: props.hiddenInMemoryCount })}
              </Button>
            </div>
          ) : null}

          {props.renderedLogsCount === 0 ? (
            props.isWelcomeState ? (
              <WelcomeCanvas />
            ) : (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-2">
                <FolderSearch className="h-8 w-8 text-muted-foreground/25" />
                <span className="ui-text-base ui-text-muted">{t('transcript.emptyThread')}</span>
              </div>
            )
          ) : null}

          {props.rowsContent}

          {props.showTurnLoading ? (
            <div data-testid="turn-loading" className="py-1">
              <LoadingStatusLine text={t('transcript.thinking')} cycleWords />
            </div>
          ) : null}

          {props.lastRpcError ? (
            <Collapsible open={props.showErrorDetails} onOpenChange={props.onShowErrorDetailsChange}>
              <Card className="gap-2 rounded-xl border-destructive/30 bg-destructive/5 px-3 py-3 shadow-none mx-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="ui-text-meta text-destructive font-medium">
                    {t('transcript.rpcErrorPrefix')}: {props.lastRpcError.message}
                  </div>
                  <CollapsibleTrigger asChild>
                    <Button type="button" variant="ghost" size="xs" className="h-6 px-2 ui-text-meta hover:bg-destructive/10">
                      {props.showErrorDetails ? t('transcript.hide') : t('transcript.details')}
                    </Button>
                  </CollapsibleTrigger>
                </div>
                <CollapsibleContent>
                  <pre className="mt-2 max-h-52 overflow-auto rounded border bg-background/50 p-2 ui-text-micro whitespace-pre-wrap font-mono">
                    {props.lastRpcErrorDetails}
                  </pre>
                </CollapsibleContent>
              </Card>
            </Collapsible>
          ) : null}
          <div ref={props.bottomRef} className="h-4" />
        </div>
      </ScrollArea>
    </section>
  )
})
