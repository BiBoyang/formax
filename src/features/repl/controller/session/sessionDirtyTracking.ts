import type { MutableRefObject } from 'react'
import type { Msg } from '../../../../shared/toolMessageTypes'

export function buildMessageByIdMap(messages: Msg[]): Map<string, Msg> {
  const map = new Map<string, Msg>()
  for (const message of messages) {
    map.set(message.id, message)
  }
  return map
}

export function markDirtyMessageIdsFromTransition(args: {
  previous: Msg[]
  next: Msg[]
  messageByIdRef: MutableRefObject<Map<string, Msg>>
  dirtyMessageIdsRef: MutableRefObject<Set<string>>
}): void {
  if (args.previous === args.next) return

  const previous = args.previous
  const next = args.next
  const minLength = Math.min(previous.length, next.length)
  let firstDiff = -1
  for (let index = 0; index < minLength; index += 1) {
    if (previous[index] !== next[index]) {
      firstDiff = index
      break
    }
  }
  if (firstDiff < 0) {
    if (previous.length === next.length) return
    firstDiff = minLength
  }

  const previousSuffixIds = new Set<string>()
  for (let index = firstDiff; index < previous.length; index += 1) {
    const message = previous[index]
    if (!message) continue
    previousSuffixIds.add(message.id)
    args.messageByIdRef.current.delete(message.id)
  }

  const nextSuffixIds = new Set<string>()
  for (let index = firstDiff; index < next.length; index += 1) {
    const message = next[index]
    if (!message) continue
    nextSuffixIds.add(message.id)
    args.messageByIdRef.current.set(message.id, message)
    args.dirtyMessageIdsRef.current.add(message.id)
  }

  for (const id of previousSuffixIds) {
    if (nextSuffixIds.has(id)) continue
    args.dirtyMessageIdsRef.current.add(id)
  }
}
