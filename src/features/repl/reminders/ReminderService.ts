import type { PromptBlock } from '../../../prompts'
import { readTodos } from '../../../tools/runtime/todosFile'
import { TODO_EMPTY_REMINDER_BODY } from '../../../prompts/reminders/todos'
import { buildClaudeMdInjectedBlocks } from '../injectedBlocks'
import { InMemoryReminderStateStore, type ReminderSessionState, type ReminderStateStore } from './ReminderStateStore'

export type ReminderServiceConfig = {
  maxRemindersPerTurn: number
  maxRemindersPerSession: number
  todoEmptyTtlMs: number
  todoStaleTtlMs: number
  todoStaleAfterToolUses: number
}

const DEFAULT_CONFIG: ReminderServiceConfig = {
  maxRemindersPerTurn: 2,
  maxRemindersPerSession: 10,
  todoEmptyTtlMs: Number.POSITIVE_INFINITY,
  todoStaleTtlMs: Number.POSITIVE_INFINITY,
  todoStaleAfterToolUses: 3,
}

const TODO_EMPTY_REMINDER = TODO_EMPTY_REMINDER_BODY

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
        for (const key of Object.keys(remindersSentAt)) {
          if (key.startsWith('todo_stale_')) delete remindersSentAt[key]
        }

        return {
          ...prev,
          lastTodoWriteAt: now,
          nonTodoToolUsesSinceLastTodoWrite: 0,
          remindersSentAt,
        }
      }

      return {
        ...prev,
        nonTodoToolUsesSinceLastTodoWrite: prev.nonTodoToolUsesSinceLastTodoWrite + 1,
      }
    })
  }

  generateInjectedBlocks(args: { cwd: string; now?: number }): PromptBlock[] {
    const now = args.now ?? Date.now()

    const reminders: PromptBlock[] = []
    const state = this.store.get()

    const todoReminders = this.buildTodoReminders({ cwd: args.cwd, now, state })
    reminders.push(...todoReminders)

    const context = buildClaudeMdInjectedBlocks({ cwd: args.cwd })
    return [...reminders, ...context]
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

    return []
  }
}

function makeSystemReminder(text: string): PromptBlock {
  return {
    type: 'text',
    text: `<system-reminder>\n${text}\n</system-reminder>`,
    cache_control: { type: 'ephemeral' },
  }
}
