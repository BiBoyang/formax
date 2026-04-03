import { makeSystemReminderBlock, type PromptBlock } from '../../../prompts'
import { readTodos } from '../../../tools/runtime/todosFile'
import { TODO_EMPTY_REMINDER_BODY, buildTodoUnusedReminderBody, buildTodoUnusedWithListReminderBody } from '../../../prompts/reminders/todos'
import { buildClaudeMdInjectedBlocks } from '../injectedBlocks'
import { InMemoryReminderStateStore, type ReminderSessionState, type ReminderStateStore } from './ReminderStateStore'

export type ReminderServiceConfig = {
  maxRemindersPerTurn: number
  maxRemindersPerSession: number
  todoEmptyTtlMs: number
  todoUnusedCooldownMs: number
  todoUnusedWithListCooldownMs: number
  todoUnusedAfterToolUses: number
  todoUnusedWithListAfterReminders: number
}

const DEFAULT_CONFIG: ReminderServiceConfig = {
  maxRemindersPerTurn: 2,
  maxRemindersPerSession: 10,
  todoEmptyTtlMs: Number.POSITIVE_INFINITY,
  todoUnusedCooldownMs: 5 * 60 * 1000,
  todoUnusedWithListCooldownMs: 5 * 60 * 1000,
  todoUnusedAfterToolUses: 3,
  todoUnusedWithListAfterReminders: 1,
}

const TODO_EMPTY_REMINDER = TODO_EMPTY_REMINDER_BODY
const TODO_UNUSED_SHORT_PREFIX = 'todo_unused_short_'
const TODO_UNUSED_LIST_PREFIX = 'todo_unused_list_'

export class ReminderService {
  private readonly store: ReminderStateStore
  private readonly config: ReminderServiceConfig

  constructor(args?: { store?: ReminderStateStore; config?: Partial<ReminderServiceConfig> }) {
    this.store = args?.store ?? new InMemoryReminderStateStore()
    this.config = { ...DEFAULT_CONFIG, ...(args?.config ?? {}) }
  }

  recordToolResult(args: { toolName: string; ok: boolean; now?: number }): void {
    const now = args.now ?? Date.now()

    this.store.update((prev) => {
      if (args.toolName === 'TodoWrite') {
        if (!args.ok) return prev

        const remindersSentAt = { ...prev.remindersSentAt }
        const remindersSentText = { ...prev.remindersSentText }
        for (const key of Object.keys(remindersSentAt)) {
          if (key.startsWith(TODO_UNUSED_SHORT_PREFIX) || key.startsWith(TODO_UNUSED_LIST_PREFIX)) {
            delete remindersSentAt[key]
            delete remindersSentText[key]
          }
        }

        return {
          ...prev,
          lastTodoWriteAt: now,
          nonTodoToolUsesSinceLastTodoWrite: 0,
          remindersSentAt,
          remindersSentText,
        }
      }

      return {
        ...prev,
        nonTodoToolUsesSinceLastTodoWrite: prev.nonTodoToolUsesSinceLastTodoWrite + 1,
      }
    })
  }

  generateInjectedBlocks(args: { cwd: string; now?: number; includeAutoMemory?: boolean }): PromptBlock[] {
    const now = args.now ?? Date.now()

    const reminders: PromptBlock[] = []
    const state = this.store.get()

    const todoReminders = this.buildTodoReminders({ cwd: args.cwd, now, state })
    reminders.push(...todoReminders)

    const context = buildClaudeMdInjectedBlocks({
      cwd: args.cwd,
      env: process.env,
      includeAutoMemory: args.includeAutoMemory,
    })
    return [...reminders, ...context]
  }

  peekInjectedBlocks(args: { cwd: string; now?: number; includeAutoMemory?: boolean }): PromptBlock[] {
    const snapshot = cloneReminderSessionState(this.store.get())
    try {
      return this.generateInjectedBlocks(args)
    } finally {
      this.store.set(snapshot)
    }
  }

  private buildTodoReminders(args: { cwd: string; now: number; state: ReminderSessionState }): PromptBlock[] {
    const { exists, todos } = readTodos(args.cwd)
    if (todos === null) return []

    const isEmpty = !exists || todos.length <= 0

    if (isEmpty) {
      // Claude Code injects this reminder every turn while the todo list is empty.
      // It is intentionally NOT deduped or rate-limited, because it acts as a
      // persistent nudge for the assistant (and is hidden from the user).
      return [makeSystemReminder(TODO_EMPTY_REMINDER)]
    }

    if (this.config.maxRemindersPerSession <= 0) return []
    if (args.state.reminderCount >= this.config.maxRemindersPerSession) return []
    if (args.state.nonTodoToolUsesSinceLastTodoWrite < this.config.todoUnusedAfterToolUses) return []

    const shortCount = countReminderPrefix(args.state.remindersSentAt, TODO_UNUSED_SHORT_PREFIX)
    const useList = shortCount >= this.config.todoUnusedWithListAfterReminders

    if (!useList) {
      const body = buildTodoUnusedReminderBody()
      if (!this.tryRecordReminder({ now: args.now, prefix: TODO_UNUSED_SHORT_PREFIX, text: body })) return []
      return [makeSystemReminder(body)]
    }

    const body = buildTodoUnusedWithListReminderBody(todos)
    if (!body) return []
    if (!this.tryRecordReminder({ now: args.now, prefix: TODO_UNUSED_LIST_PREFIX, text: body })) return []
    return [makeSystemReminder(body)]
  }

  private tryRecordReminder(args: { now: number; prefix: string; text: string }): boolean {
    const cooldownMs =
      args.prefix === TODO_UNUSED_SHORT_PREFIX ? this.config.todoUnusedCooldownMs : this.config.todoUnusedWithListCooldownMs

    const now = args.now
    let okToSend = false

    this.store.update((prev) => {
      const last = findLatestReminder(prev.remindersSentAt, args.prefix)
      if (last && now - last.at < cooldownMs) {
        okToSend = false
        return prev
      }

      if (last) {
        const lastText = prev.remindersSentText[last.key]
        if (typeof lastText === 'string' && lastText === args.text) {
          okToSend = false
          return prev
        }
      }

      const nextKey = `${args.prefix}${countReminderPrefix(prev.remindersSentAt, args.prefix) + 1}`

      okToSend = true
      return {
        ...prev,
        reminderCount: prev.reminderCount + 1,
        remindersSentAt: { ...prev.remindersSentAt, [nextKey]: now },
        remindersSentText: { ...prev.remindersSentText, [nextKey]: args.text },
      }
    })

    return okToSend
  }
}

function makeSystemReminder(text: string): PromptBlock {
  return makeSystemReminderBlock(text)
}

function countReminderPrefix(remindersSentAt: Record<string, number>, prefix: string): number {
  let count = 0
  for (const key of Object.keys(remindersSentAt)) {
    if (key.startsWith(prefix)) count++
  }
  return count
}

function findLatestReminder(
  remindersSentAt: Record<string, number>,
  prefix: string,
): { key: string; at: number } | null {
  let latest: { key: string; at: number } | null = null
  for (const [key, at] of Object.entries(remindersSentAt)) {
    if (!key.startsWith(prefix)) continue
    if (!latest || at > latest.at) latest = { key, at }
  }
  return latest
}

function cloneReminderSessionState(state: ReminderSessionState): ReminderSessionState {
  return {
    lastTodoWriteAt: state.lastTodoWriteAt,
    nonTodoToolUsesSinceLastTodoWrite: state.nonTodoToolUsesSinceLastTodoWrite,
    remindersSentAt: { ...state.remindersSentAt },
    remindersSentText: { ...state.remindersSentText },
    reminderCount: state.reminderCount,
  }
}
