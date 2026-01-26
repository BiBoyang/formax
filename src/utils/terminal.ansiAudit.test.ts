import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { findAnsiOffenders } from '../../scripts/check-no-ansi.mjs'

describe('ANSI audit', () => {
  it('keeps raw ANSI escape sequences behind src/utils/terminal.ts', () => {
    const repoRoot = path.resolve(process.cwd())
    const offenders = findAnsiOffenders({ repoRoot, allow: ['src/utils/terminal.ts'] })
    expect(offenders).toEqual([])
  })
})

