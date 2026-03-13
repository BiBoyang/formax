import { describe, expect, it } from 'vitest'
import {
  bulletList,
  makeEphemeralTextBlock,
  makeSystemReminderBlock,
  paragraph,
  rawText,
  renderPromptText,
  renderSystemReminderText,
  section,
} from './authoring'

describe('prompt authoring', () => {
  it('renders sections, paragraphs, and bullet lists with stable spacing', () => {
    const out = renderPromptText(
      [
        section('# System', [
          paragraph('Lead paragraph'),
          bulletList(['alpha', 'beta']),
          rawText('<env>\nWorking directory: /repo\n</env>'),
        ]),
        paragraph('Tail paragraph'),
      ],
      { leadingBlankLine: true },
    )

    expect(out).toBe(
      '\n# System\nLead paragraph\n\n- alpha\n- beta\n\n<env>\nWorking directory: /repo\n</env>\n\nTail paragraph',
    )
  })

  it('skips empty sections and empty list items', () => {
    const out = renderPromptText([
      section('# Empty', []),
      bulletList(['alpha', '   ', '\n', 'beta']),
      paragraph('Tail'),
    ])

    expect(out).toBe('- alpha\n- beta\n\nTail')
  })

  it('preserves raw and structured node ordering', () => {
    const out = renderPromptText([
      rawText('first raw'),
      section('# Middle', [paragraph('body')]),
      rawText('last raw'),
    ])

    expect(out).toBe('first raw\n\n# Middle\nbody\n\nlast raw')
  })

  it('wraps system reminder text consistently', () => {
    const text = renderSystemReminderText([
      paragraph('Reminder intro'),
      bulletList(['one', 'two']),
    ])

    expect(text).toBe('<system-reminder>\nReminder intro\n\n- one\n- two\n</system-reminder>')
  })

  it('creates ephemeral text blocks for reminders', () => {
    expect(makeEphemeralTextBlock('plain text')).toEqual({
      type: 'text',
      text: 'plain text',
      cache_control: { type: 'ephemeral' },
    })

    expect(makeSystemReminderBlock('internal note')).toEqual({
      type: 'text',
      text: '<system-reminder>\ninternal note\n</system-reminder>',
      cache_control: { type: 'ephemeral' },
    })
  })
})
