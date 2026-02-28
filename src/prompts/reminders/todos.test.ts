import { describe, expect, it } from 'vitest'
import {
  TODO_UNUSED_REMINDER_BODY,
  TODO_UNUSED_REMINDER_PREFIX,
  buildTodoUnusedReminderBody,
  buildTodoUnusedWithListReminderBody,
  formatTodosForClaude,
} from './todos'

describe('todos reminders', () => {
  it('returns static unused reminder body', () => {
    expect(buildTodoUnusedReminderBody()).toBe(TODO_UNUSED_REMINDER_BODY)
  })

  it('returns null when todos cannot produce valid lines', () => {
    const out = formatTodosForClaude([
      {},
      { content: '  ', status: 'pending' },
      { content: 'hello', status: ' ' },
      { content: 42, status: 'pending' },
    ])
    expect(out).toBeNull()
  })

  it('formats numbered todo lines with default limits', () => {
    const out = formatTodosForClaude([
      { status: 'pending', content: 'write tests' },
      { status: 'done', content: 'run checks' },
    ])
    expect(out).toBe('[1. [pending] write tests\n2. [done] run checks]')
  })

  it('respects maxItems and maxItemChars clipping', () => {
    const out = formatTodosForClaude(
      [
        { status: 'pending', content: 'a'.repeat(100) },
        { status: 'done', content: 'second' },
        { status: 'pending', content: 'third' },
      ],
      { maxItems: 2, maxItemChars: 20 },
    )

    expect(out).toContain('1. [pending] aaaaaa…')
    expect(out).toContain('2. [done] second')
    expect(out).not.toContain('third')
  })

  it('reduces lines to fit maxTotalChars when possible', () => {
    const out = formatTodosForClaude(
      [
        { status: 'pending', content: 'first-item' },
        { status: 'pending', content: 'second-item' },
      ],
      { maxTotalChars: 28 },
    )

    expect(out).toBe('[1. [pending] first-item]')
  })

  it('hard-truncates when a single line exceeds maxTotalChars', () => {
    const out = formatTodosForClaude([{ status: 'pending', content: 'very-long-item-text' }], {
      maxTotalChars: 12,
      maxItemChars: 200,
    })

    expect(out).toBe('[1. [pendin…')
  })

  it('treats non-positive trim limits as unlimited', () => {
    const out = formatTodosForClaude(
      [
        { status: 'pending', content: 'first' },
        { status: 'pending', content: 'second' },
      ],
      { maxItems: -1, maxItemChars: 0, maxTotalChars: 0 },
    )

    expect(out).toBe('[1. [pending] first\n2. [pending] second]')
  })

  it('builds combined reminder with formatted todo list', () => {
    const out = buildTodoUnusedWithListReminderBody([{ status: 'pending', content: 'write docs' }])
    expect(out).toContain(TODO_UNUSED_REMINDER_PREFIX)
    expect(out).toContain('Here are the existing contents of your todo list:')
    expect(out).toContain('[1. [pending] write docs]')
  })

  it('returns null for combined reminder when formatted list is empty', () => {
    expect(buildTodoUnusedWithListReminderBody([{ status: 'pending', content: ' ' }])).toBeNull()
  })
})
