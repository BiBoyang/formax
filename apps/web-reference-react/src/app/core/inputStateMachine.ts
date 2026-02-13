import type { PendingInput } from '../../types'

export function resolveSelectedInputId(args: {
  pendingInputsById: Record<string, PendingInput>
  selectedInputId: string | null
}): string | null {
  if (args.selectedInputId && args.pendingInputsById[args.selectedInputId]) {
    return args.selectedInputId
  }
  const pendingIds = Object.keys(args.pendingInputsById)
  return pendingIds[pendingIds.length - 1] ?? null
}

export function toPendingInputIdSet(pendingInputsById: Record<string, PendingInput>): Set<string> {
  return new Set(Object.keys(pendingInputsById))
}

export function pruneMapByPendingIds<T>(prev: Record<string, T>, pendingIdSet: Set<string>): Record<string, T> {
  return Object.fromEntries(Object.entries(prev).filter(([inputId]) => pendingIdSet.has(inputId)))
}

export function mapsAreShallowEqual<T>(a: Record<string, T>, b: Record<string, T>): boolean {
  const aKeys = Object.keys(a)
  const bKeys = Object.keys(b)
  if (aKeys.length !== bKeys.length) return false
  return aKeys.every((key) => Object.prototype.hasOwnProperty.call(b, key) && a[key] === b[key])
}

export function buildAskUiStateFromPendingInputs(args: {
  pendingInputs: PendingInput[]
  prevAskDockOpenByInputId: Record<string, boolean>
  prevAskDraftByInputId: Record<string, Record<string, string>>
  prevAskPageIndexByInputId: Record<string, number>
}): {
  askDockOpenByInputId: Record<string, boolean>
  askDraftByInputId: Record<string, Record<string, string>>
  askPageIndexByInputId: Record<string, number>
} {
  const askDockOpenByInputId: Record<string, boolean> = {}
  const askDraftByInputId: Record<string, Record<string, string>> = {}
  const askPageIndexByInputId: Record<string, number> = {}

  for (const input of args.pendingInputs) {
    if (input.kind !== 'ask_user_question') continue
    askDockOpenByInputId[input.inputId] = args.prevAskDockOpenByInputId[input.inputId] ?? true
    if (args.prevAskDraftByInputId[input.inputId]) {
      askDraftByInputId[input.inputId] = args.prevAskDraftByInputId[input.inputId]
    }
    askPageIndexByInputId[input.inputId] = args.prevAskPageIndexByInputId[input.inputId] ?? 0
  }

  return {
    askDockOpenByInputId,
    askDraftByInputId,
    askPageIndexByInputId,
  }
}
