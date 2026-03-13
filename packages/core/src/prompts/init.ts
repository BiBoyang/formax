import type { PromptBlock } from './types'

export function buildInitPrompt(): string {
  return `Please analyze this codebase and create a CLAUDE.md file containing:
1. Build/lint/test commands - especially how to run a single test
2. High-level architecture/structure (big picture, not every file)

If CLAUDE.md exists, improve it. Include key points from README and any Cursor/Copilot rules if present. Do not add generic advice. Prefix with:
# CLAUDE.md
This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.
`
}

export function buildInitCommandContent(): PromptBlock[] {
  return [
    {
      type: 'text',
      text: '<command-message>init is analyzing your codebase…</command-message>\n<command-name>/init</command-name>',
    },
    {
      type: 'text',
      text: buildInitPrompt(),
    },
  ]
}

