import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { toolCallToPolicyAction } from './policyAction.js'

describe('toolCallToPolicyAction', () => {
  const cwd = path.join(process.cwd(), 'tmp-policy-action')

  it('maps Bash only when command is non-empty', () => {
    const ok = toolCallToPolicyAction(
      { id: 'b1', name: 'Bash', input: { command: 'echo hi' } } as any,
      { cwd, agentDepth: 0 } as any,
    )
    expect(ok).toEqual({ kind: 'bash.exec', command: 'echo hi' })

    const empty = toolCallToPolicyAction(
      { id: 'b2', name: 'Bash', input: { command: '   ' } } as any,
      { cwd, agentDepth: 0 } as any,
    )
    expect(empty).toBeNull()
  })

  it('maps Read/Edit/Write/NotebookEdit absolute paths and rejects relative paths', () => {
    const abs = path.join(cwd, 'a.ts')
    expect(
      toolCallToPolicyAction({ id: 'r1', name: 'Read', input: { file_path: abs } } as any, { cwd, agentDepth: 0 } as any),
    ).toEqual({ kind: 'fs.read', path: abs })
    expect(
      toolCallToPolicyAction({ id: 'e1', name: 'Edit', input: { file_path: abs } } as any, { cwd, agentDepth: 0 } as any),
    ).toEqual({ kind: 'fs.write', path: abs })
    expect(
      toolCallToPolicyAction({ id: 'w1', name: 'Write', input: { file_path: abs } } as any, { cwd, agentDepth: 0 } as any),
    ).toEqual({ kind: 'fs.write', path: abs })
    expect(
      toolCallToPolicyAction(
        { id: 'n1', name: 'NotebookEdit', input: { notebook_path: abs } } as any,
        { cwd, agentDepth: 0 } as any,
      ),
    ).toEqual({ kind: 'fs.write', path: abs })

    expect(
      toolCallToPolicyAction({ id: 'r2', name: 'Read', input: { file_path: 'rel.ts' } } as any, { cwd, agentDepth: 0 } as any),
    ).toBeNull()
    expect(
      toolCallToPolicyAction({ id: 'e2', name: 'Edit', input: { file_path: 'rel.ts' } } as any, { cwd, agentDepth: 0 } as any),
    ).toBeNull()
    expect(
      toolCallToPolicyAction({ id: 'w2', name: 'Write', input: { file_path: 'rel.ts' } } as any, { cwd, agentDepth: 0 } as any),
    ).toBeNull()
    expect(
      toolCallToPolicyAction(
        { id: 'n2', name: 'NotebookEdit', input: { notebook_path: 'rel.ipynb' } } as any,
        { cwd, agentDepth: 0 } as any,
      ),
    ).toBeNull()

    expect(toolCallToPolicyAction({ id: 'r3', name: 'Read', input: {} } as any, { cwd, agentDepth: 0 } as any)).toBeNull()
    expect(
      toolCallToPolicyAction({ id: 'e3', name: 'Edit', input: { file_path: '   ' } } as any, { cwd, agentDepth: 0 } as any),
    ).toBeNull()
    expect(
      toolCallToPolicyAction({ id: 'w3', name: 'Write', input: { file_path: 1 } as any } as any, { cwd, agentDepth: 0 } as any),
    ).toBeNull()
    expect(
      toolCallToPolicyAction(
        { id: 'n3', name: 'NotebookEdit', input: { notebook_path: '   ' } } as any,
        { cwd, agentDepth: 0 } as any,
      ),
    ).toBeNull()

    expect(toolCallToPolicyAction({ id: 'e4', name: 'Edit', input: null } as any, { cwd, agentDepth: 0 } as any)).toBeNull()
    expect(
      toolCallToPolicyAction({ id: 'n4', name: 'NotebookEdit', input: null } as any, { cwd, agentDepth: 0 } as any),
    ).toBeNull()
  })

  it('maps Glob/Grep to fs.read path and supports defaulting to cwd', () => {
    const glob = toolCallToPolicyAction(
      { id: 'g1', name: 'Glob', input: { path: './src' } } as any,
      { cwd, agentDepth: 0 } as any,
    )
    expect(glob).toEqual({ kind: 'fs.read', path: path.normalize(path.join(cwd, 'src')) })

    const grep = toolCallToPolicyAction(
      { id: 'g2', name: 'Grep', input: {} } as any,
      { cwd, agentDepth: 0 } as any,
    )
    expect(grep).toEqual({ kind: 'fs.read', path: path.normalize(cwd) })

    const noCwd = toolCallToPolicyAction(
      { id: 'g3', name: 'Glob', input: { path: '' } } as any,
      { cwd: '', agentDepth: 0 } as any,
    )
    expect(noCwd).toEqual({ kind: 'fs.read', path: path.normalize(process.cwd()) })

    const nullInputGlob = toolCallToPolicyAction(
      { id: 'g4', name: 'Glob', input: null } as any,
      { cwd, agentDepth: 0 } as any,
    )
    expect(nullInputGlob).toEqual({ kind: 'fs.read', path: path.normalize(cwd) })

    const nullInputGrep = toolCallToPolicyAction(
      { id: 'g5', name: 'Grep', input: null } as any,
      { cwd, agentDepth: 0 } as any,
    )
    expect(nullInputGrep).toEqual({ kind: 'fs.read', path: path.normalize(cwd) })

    const grepWithPath = toolCallToPolicyAction(
      { id: 'g6', name: 'Grep', input: { path: './lib' } } as any,
      { cwd, agentDepth: 0 } as any,
    )
    expect(grepWithPath).toEqual({ kind: 'fs.read', path: path.normalize(path.join(cwd, 'lib')) })

    const globWhitespacePath = toolCallToPolicyAction(
      { id: 'g7', name: 'Glob', input: { path: '   ' } } as any,
      { cwd, agentDepth: 0 } as any,
    )
    expect(globWhitespacePath).toEqual({ kind: 'fs.read', path: path.normalize(cwd) })

    const grepWhitespacePath = toolCallToPolicyAction(
      { id: 'g8', name: 'Grep', input: { path: '   ' } } as any,
      { cwd, agentDepth: 0 } as any,
    )
    expect(grepWhitespacePath).toEqual({ kind: 'fs.read', path: path.normalize(cwd) })

    const globNonStringPath = toolCallToPolicyAction(
      { id: 'g9', name: 'Glob', input: { path: 123 } as any } as any,
      { cwd, agentDepth: 0 } as any,
    )
    expect(globNonStringPath).toEqual({ kind: 'fs.read', path: path.normalize(cwd) })
  })

  it('normalizes WebFetch url and validates protocol', () => {
    const http = toolCallToPolicyAction(
      { id: 'wf1', name: 'WebFetch', input: { url: 'http://example.com/a' } } as any,
      { cwd, agentDepth: 0 } as any,
    )
    expect(http).toEqual({ kind: 'net.fetch', url: 'https://example.com/a' })

    const badProtocol = toolCallToPolicyAction(
      { id: 'wf2', name: 'WebFetch', input: { url: 'ftp://example.com' } } as any,
      { cwd, agentDepth: 0 } as any,
    )
    expect(badProtocol).toBeNull()

    const badUrl = toolCallToPolicyAction(
      { id: 'wf3', name: 'WebFetch', input: { url: 'not a url' } } as any,
      { cwd, agentDepth: 0 } as any,
    )
    expect(badUrl).toBeNull()

    const alreadyHttps = toolCallToPolicyAction(
      { id: 'wf5', name: 'WebFetch', input: { url: 'https://example.com/a' } } as any,
      { cwd, agentDepth: 0 } as any,
    )
    expect(alreadyHttps).toEqual({ kind: 'net.fetch', url: 'https://example.com/a' })

    const missingUrl = toolCallToPolicyAction(
      { id: 'wf4', name: 'WebFetch', input: {} } as any,
      { cwd, agentDepth: 0 } as any,
    )
    expect(missingUrl).toBeNull()
  })

  it('maps WebSearch with trimmed query length >= 2', () => {
    const ok = toolCallToPolicyAction(
      { id: 'ws1', name: 'WebSearch', input: { query: '  ai  ' } } as any,
      { cwd, agentDepth: 0 } as any,
    )
    expect(ok).toEqual({ kind: 'net.search', query: 'ai' })

    const short = toolCallToPolicyAction(
      { id: 'ws2', name: 'WebSearch', input: { query: 'x' } } as any,
      { cwd, agentDepth: 0 } as any,
    )
    expect(short).toBeNull()

    const missing = toolCallToPolicyAction(
      { id: 'ws3', name: 'WebSearch', input: {} } as any,
      { cwd, agentDepth: 0 } as any,
    )
    expect(missing).toBeNull()
  })

  it('returns null for internal/unknown tools and non-object input', () => {
    expect(toolCallToPolicyAction({ id: 'u1', name: 'TaskOutput', input: {} } as any, { cwd, agentDepth: 0 } as any)).toBeNull()
    expect(
      toolCallToPolicyAction({ id: 'u2', name: 'Unknown', input: { anything: true } } as any, { cwd, agentDepth: 0 } as any),
    ).toBeNull()
    expect(toolCallToPolicyAction({ id: 'u3', name: 'Bash', input: [] } as any, { cwd, agentDepth: 0 } as any)).toBeNull()
  })
})
