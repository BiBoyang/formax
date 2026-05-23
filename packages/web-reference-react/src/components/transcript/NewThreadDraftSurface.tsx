import { Check, ChevronDown, FolderPlus, FolderTree, Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useI18n } from '../../app/i18n/I18nProvider'
import { folderNameFromCwd } from '../left-rail/utils'

export type NewThreadDraftSurfaceProps = {
  draftCwd: string | null
  cwdOptions: string[]
  onDraftCwdChange: (cwd: string) => void
  onDraftAddProject?: () => void
  composer: ReactNode
  feedback?: ReactNode
}

export type DraftProjectSelectorProps = {
  draftCwd: string | null
  cwdOptions: string[]
  onDraftCwdChange: (cwd: string) => void
  onDraftAddProject?: () => void
}

export function DraftProjectSelector(props: DraftProjectSelectorProps) {
  const { t } = useI18n()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [panelWidth, setPanelWidth] = useState<number>(0)
  const [searchQuery, setSearchQuery] = useState('')
  const compactRowClass = 'flex h-7 items-center rounded-md px-2 text-[11px]'
  const separatorClass = 'mx-3 my-0 border-border/70 border-t'
  const mergedCwdOptions = useMemo(() => {
    if (!props.draftCwd) return props.cwdOptions
    if (props.cwdOptions.includes(props.draftCwd)) return props.cwdOptions
    return [props.draftCwd, ...props.cwdOptions]
  }, [props.cwdOptions, props.draftCwd])
  const filteredCwdOptions = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return mergedCwdOptions
    return mergedCwdOptions.filter((cwd) => folderNameFromCwd(cwd).toLowerCase().includes(query))
  }, [mergedCwdOptions, searchQuery])

  useEffect(() => {
    if (!isOpen) return
    setPanelWidth(triggerRef.current?.offsetWidth ?? 0)
    const onWindowResize = () => {
      setPanelWidth(triggerRef.current?.offsetWidth ?? 0)
    }
    const onDocumentPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    const onDocumentKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false)
      }
    }
    window.addEventListener('resize', onWindowResize)
    document.addEventListener('pointerdown', onDocumentPointerDown)
    document.addEventListener('keydown', onDocumentKeyDown)
    return () => {
      window.removeEventListener('resize', onWindowResize)
      document.removeEventListener('pointerdown', onDocumentPointerDown)
      document.removeEventListener('keydown', onDocumentKeyDown)
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    searchInputRef.current?.focus()
  }, [isOpen])

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        onClick={() => {
          setIsOpen((previous) => !previous)
        }}
        className="inline-flex h-7 w-auto max-w-[14rem] items-center justify-between gap-1 rounded-md px-2 text-left text-muted-foreground transition-colors hover:bg-foreground/6 hover:text-foreground focus:outline-none focus-visible:outline-none focus-visible:ring-0"
      >
        <span className="flex min-w-0 items-center gap-2">
          <FolderTree className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="truncate text-[11px] text-foreground/82">
            {props.draftCwd
              ? folderNameFromCwd(props.draftCwd)
              : t('transcript.newThreadSelectProject')}
          </span>
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
      </button>
      {isOpen ? (
        <div
          role="listbox"
          style={{ width: `${Math.max(panelWidth, 220)}px` }}
          className="absolute left-0 top-full z-50 mt-1 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-border/80 bg-popover p-0 shadow-lg"
        >
          <div className="mx-1 my-1">
            <label className="flex h-7 items-center gap-2 rounded-md px-2 text-[11px] text-muted-foreground transition-colors hover:bg-muted/70 focus-within:bg-muted/70">
              <Search className="h-3.5 w-3.5 shrink-0" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder={t('transcript.newThreadSearchProject')}
                className="h-full w-full bg-transparent text-[11px] text-foreground placeholder:text-muted-foreground/85 outline-none"
              />
            </label>
          </div>
          <div className={separatorClass} />
          <div className="max-h-[8.75rem] overflow-y-auto px-1 py-0">
            {filteredCwdOptions.map((cwd) => {
              const isSelected = props.draftCwd === cwd
              const folderName = folderNameFromCwd(cwd)
              return (
                <button
                  type="button"
                  key={cwd}
                  role="option"
                  aria-selected={isSelected}
                  className={`${compactRowClass} w-full justify-between gap-3 text-left hover:bg-muted/70`}
                  onClick={() => {
                    props.onDraftCwdChange(cwd)
                    setIsOpen(false)
                  }}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <FolderTree className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">{folderName}</span>
                  </span>
                  {isSelected ? <Check className="h-4 w-4 shrink-0 text-foreground/80" /> : null}
                </button>
              )
            })}
          </div>
          <div className={separatorClass} />
          <button
            type="button"
            disabled={!props.onDraftAddProject}
            className={`mx-1 my-1 ${compactRowClass} w-[calc(100%-0.5rem)] hover:bg-muted/70 disabled:cursor-not-allowed disabled:opacity-50`}
            onClick={() => {
              props.onDraftAddProject?.()
              setIsOpen(false)
            }}
          >
            <span className="flex items-center gap-2">
              <FolderPlus className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span>{t('transcript.newThreadAddProject')}</span>
            </span>
          </button>
        </div>
      ) : null}
    </div>
  )
}

export function NewThreadDraftSurface(props: NewThreadDraftSurfaceProps) {
  const { t } = useI18n()

  return (
    <section
      data-testid="new-thread-draft-surface"
      className="flex flex-1 min-h-0 items-center justify-center px-8 pt-8 pb-14"
    >
      <div className="w-full max-w-4xl">
        <div className="mx-auto mb-10 max-w-2xl text-center">
          <h1 className="text-2xl tracking-tight text-foreground/80">
            {t('transcript.newThreadTitle')}
          </h1>
        </div>

        {props.composer}

        <div className="mx-auto mt-14 max-w-3xl">
          {props.feedback ? <div className="mt-4">{props.feedback}</div> : null}
        </div>
      </div>
    </section>
  )
}
