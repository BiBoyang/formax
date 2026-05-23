import { Check, ChevronDown, FolderPlus, FolderTree } from 'lucide-react'
import { useMemo, type ReactNode } from 'react'
import { useI18n } from '../../app/i18n/I18nProvider'
import { folderNameFromCwd } from '../left-rail/utils'
import { Button } from '../ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '../ui/dropdown-menu'

export type NewThreadDraftSurfaceProps = {
  draftCwd: string | null
  cwdOptions: string[]
  onDraftCwdChange: (cwd: string) => void
  onDraftAddProject?: () => void
  composer: ReactNode
  feedback?: ReactNode
}

export function NewThreadDraftSurface(props: NewThreadDraftSurfaceProps) {
  const { t } = useI18n()
  const mergedCwdOptions = useMemo(() => {
    if (!props.draftCwd) return props.cwdOptions
    if (props.cwdOptions.includes(props.draftCwd)) return props.cwdOptions
    return [props.draftCwd, ...props.cwdOptions]
  }, [props.cwdOptions, props.draftCwd])

  return (
    <section
      data-testid="new-thread-draft-surface"
      className="flex flex-1 min-h-0 items-center justify-center px-8 pt-8 pb-14"
    >
      <div className="w-full max-w-4xl">
        <div className="mx-auto mb-10 max-w-2xl text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground/80">
            {t('transcript.newThreadTitle')}
          </h1>
        </div>

        {props.composer}

        <div className="mx-auto mt-4 max-w-3xl">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                className="h-11 w-full justify-between rounded-xl border border-border/70 bg-background/75 px-3 text-left shadow-sm hover:bg-background/90"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <FolderTree className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="truncate text-sm text-foreground/90">
                    {props.draftCwd
                      ? folderNameFromCwd(props.draftCwd)
                      : t('transcript.newThreadSelectProject')}
                  </span>
                </span>
                <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="center" className="w-[min(30rem,calc(100vw-3rem))]">
              {mergedCwdOptions.map((cwd) => {
                const isSelected = props.draftCwd === cwd
                return (
                  <DropdownMenuItem
                    key={cwd}
                    className="flex items-center justify-between gap-3"
                    onSelect={() => {
                      props.onDraftCwdChange(cwd)
                    }}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <FolderTree className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="truncate">{folderNameFromCwd(cwd)}</span>
                    </span>
                    {isSelected ? <Check className="h-4 w-4 shrink-0 text-foreground/80" /> : null}
                  </DropdownMenuItem>
                )
              })}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={!props.onDraftAddProject}
                onSelect={() => {
                  props.onDraftAddProject?.()
                }}
              >
                <span className="flex items-center gap-2">
                  <FolderPlus className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span>{t('transcript.newThreadAddProject')}</span>
                </span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {!props.draftCwd ? (
            <p className="mt-3 px-1 text-sm text-muted-foreground">
              {t('transcript.newThreadProjectRequired')}
            </p>
          ) : null}

          {props.feedback ? <div className="mt-4">{props.feedback}</div> : null}
        </div>
      </div>
    </section>
  )
}
