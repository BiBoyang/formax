import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createSubAgentRegistry } from './registry'

describe('SubAgentRegistry', () => {
  let dir: string

  beforeEach(async () => {
    dir = path.join(os.tmpdir(), `subagents-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    await fsp.mkdir(dir, { recursive: true })
  })

  afterEach(async () => {
    await fsp.rm(dir, { recursive: true, force: true })
  })

  it('loads valid sub-agent markdown with YAML frontmatter', async () => {
    await fsp.writeFile(
      path.join(dir, 'code-reviewer.md'),
      `---
name: code-reviewer
description: "Reviews code for bugs"
tools:
  - Read
  - Grep
---

You are a reviewer.
`,
      'utf8',
    )

    const registry = createSubAgentRegistry({ includeBuiltins: false })
    await registry.loadFromDirectory(dir)

    expect(registry.list()).toContainEqual({
      name: 'code-reviewer',
      description: 'Reviews code for bugs',
    })

    const agent = registry.get('code-reviewer')
    expect(agent).toEqual({
      name: 'code-reviewer',
      description: 'Reviews code for bugs',
      tools: ['Read', 'Grep'],
      systemPrompt: 'You are a reviewer.',
    })
  })

  it('ignores invalid markdown files', async () => {
    await fsp.writeFile(path.join(dir, 'no-frontmatter.md'), 'hello', 'utf8')
    await fsp.writeFile(path.join(dir, 'broken-frontmatter.md'), '---\nname: x\n', 'utf8')
    await fsp.writeFile(
      path.join(dir, 'missing-fields.md'),
      `---
name: ""
description: ""
---

nope
`,
      'utf8',
    )

    const registry = createSubAgentRegistry({ includeBuiltins: false })
    await registry.loadFromDirectory(dir)
    expect(registry.list()).toEqual([])
  })
})
