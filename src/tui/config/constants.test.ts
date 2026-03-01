import { describe, expect, it } from 'vitest'
import {
  CONFIG_ROWS,
  INITIAL_CONFIG_STATE,
  OUTPUT_STYLE_OPTIONS,
  type ConfigRow,
  type ConfigState,
} from './constants'

function getRow(id: string): ConfigRow {
  const row = CONFIG_ROWS.find((entry) => entry.id === id)
  if (!row) throw new Error(`Missing config row: ${id}`)
  return row
}

describe('ui/config/constants', () => {
  it('exports default options and initial state', () => {
    expect(OUTPUT_STYLE_OPTIONS.map((option) => option.id)).toEqual(['default', 'explanatory', 'learning'])
    expect(INITIAL_CONFIG_STATE.values).toEqual({
      outputStyle: 'default',
      thinkingMode: true,
      verboseOutput: false,
    })
  })

  it('resolves explicit values for all config rows', () => {
    const state: ConfigState = {
      values: {
        thinkingMode: false,
        verboseOutput: true,
        outputStyle: 'learning',
      },
      sources: {},
    }

    expect(getRow('thinkingMode').getValue(state)).toBe(false)
    expect(getRow('verboseOutput').getValue(state)).toBe(true)
    expect(getRow('outputStyle').getValue(state)).toBe('Learning')
  })

  it('uses default fallbacks when values are missing or unknown', () => {
    const missing: ConfigState = { values: {}, sources: {} }
    expect(getRow('thinkingMode').getValue(missing)).toBe(true)
    expect(getRow('verboseOutput').getValue(missing)).toBe(false)
    expect(getRow('outputStyle').getValue(missing)).toBe('Default')

    const unknown: ConfigState = { values: { outputStyle: 'custom' }, sources: {} }
    expect(getRow('outputStyle').getValue(unknown)).toBe('Default')
  })
})
