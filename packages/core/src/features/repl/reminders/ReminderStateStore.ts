export type ReminderSessionState = {
  lastTodoWriteAt: number | null
  nonTodoToolUsesSinceLastTodoWrite: number
  remindersSentAt: Record<string, number>
  remindersSentText: Record<string, string>
  reminderCount: number
}

export interface ReminderStateStore {
  get: () => ReminderSessionState
  set: (next: ReminderSessionState) => void
  update: (fn: (prev: ReminderSessionState) => ReminderSessionState) => ReminderSessionState
}

const DEFAULT_STATE: ReminderSessionState = {
  lastTodoWriteAt: null,
  nonTodoToolUsesSinceLastTodoWrite: 0,
  remindersSentAt: {},
  remindersSentText: {},
  reminderCount: 0,
}

export class InMemoryReminderStateStore implements ReminderStateStore {
  private state: ReminderSessionState

  constructor(initial?: Partial<ReminderSessionState>) {
    this.state = {
      ...DEFAULT_STATE,
      ...initial,
      remindersSentAt: { ...DEFAULT_STATE.remindersSentAt, ...(initial?.remindersSentAt ?? {}) },
      remindersSentText: { ...DEFAULT_STATE.remindersSentText, ...(initial?.remindersSentText ?? {}) },
    }
  }

  get(): ReminderSessionState {
    return {
      ...this.state,
      remindersSentAt: { ...this.state.remindersSentAt },
      remindersSentText: { ...this.state.remindersSentText },
    }
  }

  set(next: ReminderSessionState): void {
    this.state = {
      ...next,
      remindersSentAt: { ...next.remindersSentAt },
      remindersSentText: { ...next.remindersSentText },
    }
  }

  update(fn: (prev: ReminderSessionState) => ReminderSessionState): ReminderSessionState {
    const next = fn(this.get())
    this.set(next)
    return next
  }
}
