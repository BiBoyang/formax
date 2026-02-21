import { cn } from '../../lib/utils'

type DiffRow = {
  kind: 'meta' | 'add' | 'del' | 'ctx'
  text: string
  oldLine: number | null
  newLine: number | null
}

function parsePatchRows(patch: string): DiffRow[] {
  const rows: DiffRow[] = []
  let oldLine: number | null = null
  let newLine: number | null = null
  let inHunk = false

  for (const line of patch.split('\n')) {
    if (line.startsWith('@@')) {
      const m = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
      if (m) {
        oldLine = Number(m[1])
        newLine = Number(m[2])
      } else {
        oldLine = null
        newLine = null
      }
      inHunk = true
      rows.push({ kind: 'meta', text: line.replace(/^@@.*?@@\s?/, '').trim() || '···', oldLine: null, newLine: null })
      continue
    }

    if (line.startsWith('+') && !line.startsWith('+++')) {
      rows.push({ kind: 'add', text: line, oldLine: null, newLine })
      if (newLine !== null) newLine += 1
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      rows.push({ kind: 'del', text: line, oldLine, newLine: null })
      if (oldLine !== null) oldLine += 1
    } else if (inHunk && !line.startsWith('\\')) {
      rows.push({ kind: 'ctx', text: line, oldLine, newLine })
      if (oldLine !== null) oldLine += 1
      if (newLine !== null) newLine += 1
    }
  }
  return rows
}

export function DiffPatchView(props: { patch: string; maxHeightClassName?: string }) {
  const rows = parsePatchRows(props.patch)
  return (
    <div className="bg-white rounded-b-[10px] overflow-hidden">
      <div
        className={cn(
          'min-w-0 overflow-x-hidden overflow-y-auto font-mono text-[12px] leading-relaxed',
          props.maxHeightClassName ?? 'max-h-[1200px]',
        )}
      >
        {rows.map((row, index) => (
          <div
            key={index}
            className={cn(
              'grid grid-cols-[48px_minmax(0,1fr)] relative group/line',
              row.kind === 'add' && 'bg-emerald-500/[0.04] hover:bg-emerald-500/[0.07]',
              row.kind === 'del' && 'bg-red-500/[0.04] hover:bg-red-500/[0.07]',
              row.kind === 'meta' && 'bg-muted/30 text-muted-foreground/40 italic text-[11px] py-1',
            )}
          >
            {(row.kind === 'add' || row.kind === 'del') && (
              <div className={cn('absolute left-0 top-0 bottom-0 w-[4px]', row.kind === 'add' ? 'bg-emerald-500/60' : 'bg-red-500/60')} />
            )}
            <div className="select-none px-2 text-right text-muted-foreground/30 text-[10px] flex items-center justify-end border-r border-border/10">
              {row.kind === 'del' ? row.oldLine : (row.newLine ?? '')}
            </div>
            <div className={cn('min-w-0 px-4 flex items-start', row.kind === 'add' && 'text-emerald-700/90', row.kind === 'del' && 'text-red-700/90')}>
              <span className="opacity-30 mr-3 w-2 shrink-0 select-none text-[13px]">
                {row.kind === 'add' ? '+' : row.kind === 'del' ? '-' : ' '}
              </span>
              <span className="min-w-0 flex-1 whitespace-pre-wrap break-all py-0.5">
                {row.text.startsWith('+') || row.text.startsWith('-') ? row.text.slice(1) : row.text}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
