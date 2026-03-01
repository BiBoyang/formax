import { describe, expectTypeOf, it } from 'vitest'
import { TODO_STATUSES, type TodoItem, type TodoStatus } from './todoContracts'

describe('todoContracts', () => {
  it('keeps todo status union stable', () => {
    const pending: TodoStatus = 'pending'
    const inProgress: TodoStatus = 'in_progress'
    const completed: TodoStatus = 'completed'

    expectTypeOf(pending).toMatchTypeOf<TodoStatus>()
    expectTypeOf(inProgress).toMatchTypeOf<TodoStatus>()
    expectTypeOf(completed).toMatchTypeOf<TodoStatus>()
  })

  it('keeps todo item shape stable', () => {
    const item: TodoItem = {
      content: 'Implement feature',
      status: 'in_progress',
      activeForm: 'Implementing feature',
    }

    expectTypeOf(item).toMatchTypeOf<TodoItem>()
  })

  it('exports canonical status list', () => {
    expect(TODO_STATUSES).toEqual(['pending', 'in_progress', 'completed'])
  })
})
