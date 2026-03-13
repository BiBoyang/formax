import { describe, expect, it } from 'vitest'
import type { SlashCommandSpec } from '../../features/commands/registry'
import { createSlashCommandSpecMap, resolveSlashCommandInputHint } from './inputHint'

const compactSpec: SlashCommandSpec = {
  id: 'builtin:/compact',
  source: 'builtin',
  command: '/compact',
  description: 'Clear conversation history but keep a summary in context.',
  argHint: '<optional custom summarization instructions>',
  implemented: true,
}

const statusSpec: SlashCommandSpec = {
  id: 'builtin:/status',
  source: 'builtin',
  command: '/status',
  description: 'Show status',
  implemented: true,
}

describe('resolveSlashCommandInputHint', () => {
  it('builds command map case-insensitively and keeps the first duplicate', () => {
    const dupeCompactSpec: SlashCommandSpec = {
      ...compactSpec,
      id: 'builtin:/compact-dupe',
      command: '/COMPACT',
      argHint: '<dupe>',
    }
    const map = createSlashCommandSpecMap([compactSpec, dupeCompactSpec])
    expect(map.get('/compact')?.id).toBe(compactSpec.id)
  })

  it('shows compact hint with a leading separator when no space typed yet', () => {
    const map = createSlashCommandSpecMap([compactSpec, statusSpec])
    expect(resolveSlashCommandInputHint({ input: '/compact', slashSpecByCommand: map })).toBe(
      ' <optional custom summarization instructions>',
    )
  })

  it('does not add an extra separator when a trailing space already exists', () => {
    const map = createSlashCommandSpecMap([compactSpec, statusSpec])
    expect(resolveSlashCommandInputHint({ input: '/compact ', slashSpecByCommand: map })).toBe(
      '<optional custom summarization instructions>',
    )
    expect(resolveSlashCommandInputHint({ input: '/compact   ', slashSpecByCommand: map })).toBe(
      '<optional custom summarization instructions>',
    )
  })

  it('hides hint once compact arguments are present', () => {
    const map = createSlashCommandSpecMap([compactSpec, statusSpec])
    expect(resolveSlashCommandInputHint({ input: '/compact custom', slashSpecByCommand: map })).toBe(null)
  })

  it('does not show hint for commands without argHint', () => {
    const map = createSlashCommandSpecMap([compactSpec, statusSpec])
    expect(resolveSlashCommandInputHint({ input: '/status', slashSpecByCommand: map })).toBe(null)
  })

  it('returns null for non-command or missing input', () => {
    const map = createSlashCommandSpecMap([compactSpec, statusSpec])
    expect(resolveSlashCommandInputHint({ input: 'hello', slashSpecByCommand: map })).toBe(null)
    expect(resolveSlashCommandInputHint({ input: undefined as any, slashSpecByCommand: map })).toBe(null)
  })
})
