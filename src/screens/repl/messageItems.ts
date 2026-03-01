import type { Msg } from '../../shared/toolMessageTypes'

export type MessageItemDescriptor =
  | { kind: 'message'; key: string; message: Msg }
  | { kind: 'explore-group'; key: string; tasks: Msg[] }

export function deriveMessageItemDescriptors(
  messages: Msg[],
  opts: { groupExploreTasks: boolean },
): MessageItemDescriptor[] {
  if (!opts.groupExploreTasks) {
    return messages.map((message) => ({ kind: 'message', key: message.id, message }))
  }

  const items: MessageItemDescriptor[] = []

  let i = 0
  while (i < messages.length) {
    const group = findContiguousExploreTaskGroupFrom(messages, i)
    if (group && group.tasks.length >= 2) {
      const groupId = exploreGroupId(group.tasks[0]!.id)
      items.push({ kind: 'explore-group', key: groupId, tasks: group.tasks })
      i = group.end + 1
      continue
    }

    const message = messages[i]!
    items.push({ kind: 'message', key: message.id, message })
    i++
  }

  return items
}

export function exploreGroupId(firstTaskMsgId: string): string {
  return `explore-group-${firstTaskMsgId}`
}

function isExploreTaskMessage(msg: Msg | undefined): msg is Msg {
  if (!msg) return false
  if (msg.role !== 'tool') return false
  if (msg.toolInfo?.name !== 'Task') return false
  if (msg.toolInfo?.status === 'running') return false
  const subagentType = (msg.toolInfo?.input as any)?.subagent_type
  return String(subagentType || '') === 'Explore'
}

export function findContiguousExploreTaskGroupFrom(
  messages: Msg[],
  startIndex: number,
): { tasks: Msg[]; start: number; end: number } | null {
  if (!isExploreTaskMessage(messages[startIndex])) return null
  let end = startIndex
  while (end + 1 < messages.length && isExploreTaskMessage(messages[end + 1]!)) end++
  return { tasks: messages.slice(startIndex, end + 1), start: startIndex, end }
}

export function findLastContiguousExploreTaskGroup(
  messages: Msg[],
): { tasks: Msg[]; start: number; end: number } | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (!isExploreTaskMessage(messages[i])) continue
    let start = i
    while (start - 1 >= 0 && isExploreTaskMessage(messages[start - 1]!)) start--
    return { tasks: messages.slice(start, i + 1), start, end: i }
  }
  return null
}
