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
model: sonnet
color: blue
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
      model: 'sonnet',
    })

    const agent = registry.get('code-reviewer')
    expect(agent).toEqual({
      name: 'code-reviewer',
      description: 'Reviews code for bugs',
      tools: ['Read', 'Grep'],
      systemPrompt: 'You are a reviewer.',
      model: 'sonnet',
      color: 'blue',
    })
  })

  it('supports Claude-style tools as a comma-separated string', async () => {
    await fsp.writeFile(
      path.join(dir, 'edit-tool-demo.md'),
      `---
name: edit-tool-demo
description: "Edit demo"
tools: Edit, Write, NotebookEdit
---

You are an editor.
`,
      'utf8',
    )

    const registry = createSubAgentRegistry({ includeBuiltins: false })
    await registry.loadFromDirectory(dir)

    const agent = registry.get('edit-tool-demo')
    expect(agent).toEqual({
      name: 'edit-tool-demo',
      description: 'Edit demo',
      tools: ['Edit', 'Write', 'NotebookEdit'],
      systemPrompt: 'You are an editor.',
    })
  })

  it('treats missing tools as allow-all', async () => {
    await fsp.writeFile(
      path.join(dir, 'code-reviewer.md'),
      `---
name: code-reviewer
description: "Reviews code"
model: sonnet
color: blue
---

You are a reviewer.
`,
      'utf8',
    )

    const registry = createSubAgentRegistry({ includeBuiltins: false })
    await registry.loadFromDirectory(dir)

    const agent = registry.get('code-reviewer')
    expect(agent).toEqual({
      name: 'code-reviewer',
      description: 'Reviews code',
      tools: ['*'],
      systemPrompt: 'You are a reviewer.',
      model: 'sonnet',
      color: 'blue',
    })
  })

  it('loads directories in order (later overrides earlier)', async () => {
    const userDir = path.join(dir, 'user')
    const projectDir = path.join(dir, 'project')
    await fsp.mkdir(userDir, { recursive: true })
    await fsp.mkdir(projectDir, { recursive: true })

    await fsp.writeFile(
      path.join(userDir, 'agent.md'),
      `---
name: code-reviewer
description: "User agent"
tools: Read
---

User prompt.
`,
      'utf8',
    )

    await fsp.writeFile(
      path.join(projectDir, 'agent.md'),
      `---
name: code-reviewer
description: "Project agent"
tools: Read, Grep
---

Project prompt.
`,
      'utf8',
    )

    const registry = createSubAgentRegistry({ includeBuiltins: false })
    await registry.loadFromDirectories([userDir, projectDir])

    expect(registry.get('code-reviewer')).toEqual({
      name: 'code-reviewer',
      description: 'Project agent',
      tools: ['Read', 'Grep'],
      systemPrompt: 'Project prompt.',
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
