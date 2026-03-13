export type TodoStatus = 'pending' | 'in_progress' | 'completed'

export type TodoItem = {
  content: string
  status: TodoStatus
  activeForm: string
}

export const TODO_STATUSES: readonly TodoStatus[] = ['pending', 'in_progress', 'completed']
