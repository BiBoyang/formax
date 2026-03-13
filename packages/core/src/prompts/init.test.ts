import { describe, expect, it } from 'vitest'
import { buildInitCommandContent, buildInitPrompt } from './init.js'

describe('prompts/init', () => {
  it('buildInitPrompt returns the CLAUDE.md setup instructions', () => {
    const prompt = buildInitPrompt()
    expect(prompt).toContain('Please analyze this codebase')
    expect(prompt).toContain('# CLAUDE.md')
    expect(prompt).toContain('guidance to Claude Code')
  })

  it('buildInitCommandContent wraps command banner and prompt in text blocks', () => {
    const blocks = buildInitCommandContent()
    const promptBlock = blocks[1] as { type?: string; text?: string }
    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toEqual({
      type: 'text',
      text: '<command-message>init is analyzing your codebase…</command-message>\n<command-name>/init</command-name>',
    })
    expect(promptBlock.type).toBe('text')
    expect(promptBlock.text).toBe(buildInitPrompt())
  })
})
