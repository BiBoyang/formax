import { describe, expect, it } from 'vitest'
import { buildBashParamsFromInput, buildBashParamsFromParamsText } from './bashParams'

describe('bashParams presentation model', () => {
  it('extracts command and ordered params from paramsText', () => {
    const model = buildBashParamsFromParamsText('cwd="/repo", command="ls -la", timeout=1000')

    expect(model.hasCommandParam).toBe(true)
    expect(model.command).toBe('ls -la')
    expect(model.paramsText).toBe('command="ls -la", cwd="/repo", timeout=1000')
    expect(model.paramsTextWithoutCommand).toBe('cwd="/repo", timeout=1000')
  })

  it('extracts command and params from input objects', () => {
    const model = buildBashParamsFromInput({
      cwd: '/repo',
      command: 'pwd',
      timeout: 1000,
    })

    expect(model.hasCommandParam).toBe(true)
    expect(model.command).toBe('pwd')
    expect(model.paramsText).toBe('command="pwd", cwd="/repo", timeout=1000')
    expect(model.paramsTextWithoutCommand).toBe('cwd="/repo", timeout=1000')
  })

  it('handles missing params gracefully', () => {
    expect(buildBashParamsFromParamsText(undefined)).toEqual({
      hasCommandParam: false,
      command: null,
      paramsText: undefined,
      paramsTextWithoutCommand: undefined,
    })
    expect(buildBashParamsFromInput(undefined)).toEqual({
      hasCommandParam: false,
      command: null,
      paramsText: undefined,
      paramsTextWithoutCommand: undefined,
    })
  })

  it('handles paramsText without command and preserves raw fallback when parsing yields no params', () => {
    const noCommand = buildBashParamsFromParamsText('cwd="/repo", timeout=1000')
    expect(noCommand.hasCommandParam).toBe(false)
    expect(noCommand.command).toBeNull()
    expect(noCommand.paramsText).toBe('cwd="/repo", timeout=1000')
    expect(noCommand.paramsTextWithoutCommand).toBe('cwd="/repo", timeout=1000')

    const unparsable = buildBashParamsFromParamsText('not-a-pair')
    expect(unparsable.hasCommandParam).toBe(false)
    expect(unparsable.command).toBeNull()
    expect(unparsable.paramsText).toBe('not-a-pair')
    expect(unparsable.paramsTextWithoutCommand).toBeUndefined()
  })
})
