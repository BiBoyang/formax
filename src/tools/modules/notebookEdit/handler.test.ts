import { describe, expect, it, vi } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fsp from 'node:fs/promises'
import { createNotebookEditToolHandler } from './handler'

function makeNotebook(cells: any[]) {
  return {
    nbformat: 4,
    nbformat_minor: 5,
    metadata: {},
    cells,
  }
}

describe('NotebookEditToolHandler', () => {
  it('matches tool name with canHandle', () => {
    const handler = createNotebookEditToolHandler()
    expect(handler.canHandle('NotebookEdit')).toBe(true)
    expect(handler.canHandle('Other')).toBe(false)
  })

  it('returns error in plan mode', async () => {
    const handler = createNotebookEditToolHandler()
    const result = await handler.execute(
      { id: 'p', name: 'NotebookEdit', input: {} as any },
      { cwd: process.cwd(), agentDepth: 0, replMode: 'plan' },
    )
    expect(result.is_error).toBe(true)
    expect(result.content).toContain('Plan mode is active')
  })

  it('handles missing input object outside plan mode', async () => {
    const handler = createNotebookEditToolHandler()
    const result = await handler.execute(
      { id: 'p2', name: 'NotebookEdit' } as any,
      { cwd: process.cwd(), agentDepth: 0, replMode: 'acceptEdits' },
    )
    expect(result.is_error).toBe(true)
    expect(result.content).toContain('Missing notebook_path')
  })

  it('replaces a cell source by id', async () => {
    const handler = createNotebookEditToolHandler()
    const tmp = path.join(os.tmpdir(), `formax-notebook-${Date.now()}-1.ipynb`)
    const nb = makeNotebook([
      { id: 'a', cell_type: 'code', metadata: {}, source: ['print("old")\n'], outputs: [], execution_count: null },
    ])
    await fsp.writeFile(tmp, JSON.stringify(nb), 'utf8')

    const result = await handler.execute(
      {
        id: '1',
        name: 'NotebookEdit',
        input: { notebook_path: tmp, cell_id: 'a', new_source: 'print("new")', cell_type: 'markdown' },
      },
      { cwd: process.cwd(), agentDepth: 0, replMode: 'acceptEdits' },
    )

    expect(result.is_error).toBeUndefined()
    const updated = JSON.parse(await fsp.readFile(tmp, 'utf8'))
    expect(updated.cells[0].cell_type).toBe('markdown')
    expect(updated.cells[0].source.join('')).toContain('print("new")')
    await fsp.unlink(tmp)
  })

  it('inserts a new cell after an id', async () => {
    const handler = createNotebookEditToolHandler()
    const tmp = path.join(os.tmpdir(), `formax-notebook-${Date.now()}-2.ipynb`)
    const nb = makeNotebook([
      { id: 'a', cell_type: 'markdown', metadata: {}, source: ['# old\n'] },
      { id: 'b', cell_type: 'markdown', metadata: {}, source: ['# b\n'] },
    ])
    await fsp.writeFile(tmp, JSON.stringify(nb), 'utf8')

    const result = await handler.execute(
      {
        id: '2',
        name: 'NotebookEdit',
        input: { notebook_path: tmp, cell_id: 'a', new_source: '# inserted', edit_mode: 'insert', cell_type: 'code' },
      },
      { cwd: process.cwd(), agentDepth: 0, replMode: 'acceptEdits' },
    )

    expect(result.is_error).toBeUndefined()
    const updated = JSON.parse(await fsp.readFile(tmp, 'utf8'))
    expect(updated.cells).toHaveLength(3)
    expect(updated.cells[1].cell_type).toBe('code')
    expect(updated.cells[1].execution_count).toBeNull()
    expect(Array.isArray(updated.cells[1].outputs)).toBe(true)
    expect(updated.cells[1].source.join('')).toContain('# inserted')
    await fsp.unlink(tmp)
  })

  it('inserts at start when cell_id is omitted', async () => {
    const handler = createNotebookEditToolHandler()
    const tmp = path.join(os.tmpdir(), `formax-notebook-${Date.now()}-start.ipynb`)
    const nb = makeNotebook([{ id: 'b', cell_type: 'markdown', metadata: {}, source: ['# b\n'] }])
    await fsp.writeFile(tmp, JSON.stringify(nb), 'utf8')

    const result = await handler.execute(
      {
        id: '2b',
        name: 'NotebookEdit',
        input: { notebook_path: tmp, new_source: '# first', edit_mode: 'insert', cell_type: 'markdown' },
      } as any,
      { cwd: process.cwd(), agentDepth: 0, replMode: 'acceptEdits' },
    )
    expect(result.is_error).toBeUndefined()
    const updated = JSON.parse(await fsp.readFile(tmp, 'utf8'))
    expect(updated.cells[0].source.join('')).toContain('# first')
    await fsp.unlink(tmp)
  })

  it('deletes a cell by id', async () => {
    const handler = createNotebookEditToolHandler()
    const tmp = path.join(os.tmpdir(), `formax-notebook-${Date.now()}-3.ipynb`)
    const nb = makeNotebook([
      { id: 'a', cell_type: 'markdown', metadata: {}, source: ['# a\n'] },
      { id: 'b', cell_type: 'markdown', metadata: {}, source: ['# b\n'] },
    ])
    await fsp.writeFile(tmp, JSON.stringify(nb), 'utf8')

    const result = await handler.execute(
      {
        id: '3',
        name: 'NotebookEdit',
        input: { notebook_path: tmp, cell_id: 'a', new_source: '', edit_mode: 'delete' },
      },
      { cwd: process.cwd(), agentDepth: 0, replMode: 'acceptEdits' },
    )

    expect(result.is_error).toBeUndefined()
    const updated = JSON.parse(await fsp.readFile(tmp, 'utf8'))
    expect(updated.cells).toHaveLength(1)
    expect(updated.cells[0].id).toBe('b')
    await fsp.unlink(tmp)
  })

  it('validates input and notebook shape errors', async () => {
    const handler = createNotebookEditToolHandler()
    const tmp = path.join(os.tmpdir(), `formax-notebook-${Date.now()}-err.ipynb`)
    await fsp.writeFile(tmp, JSON.stringify({ bad: true }), 'utf8')

    const missingPath = await handler.execute(
      { id: 'e1', name: 'NotebookEdit', input: { cell_id: 'a', new_source: 'x' } as any },
      { cwd: process.cwd(), agentDepth: 0, replMode: 'acceptEdits' },
    )
    expect(missingPath.is_error).toBe(true)

    const blankPath = await handler.execute(
      { id: 'e1b', name: 'NotebookEdit', input: { notebook_path: '   ', cell_id: 'a', new_source: 'x' } as any },
      { cwd: process.cwd(), agentDepth: 0, replMode: 'acceptEdits' },
    )
    expect(blankPath.is_error).toBe(true)

    const invalidMode = await handler.execute(
      { id: 'e2', name: 'NotebookEdit', input: { notebook_path: tmp, new_source: 'x', edit_mode: 'bad' } as any },
      { cwd: process.cwd(), agentDepth: 0, replMode: 'acceptEdits' },
    )
    expect(invalidMode.is_error).toBe(true)
    expect(invalidMode.content).toContain('Invalid edit_mode')

    const missingSource = await handler.execute(
      { id: 'e3', name: 'NotebookEdit', input: { notebook_path: tmp, cell_id: 'a' } as any },
      { cwd: process.cwd(), agentDepth: 0, replMode: 'acceptEdits' },
    )
    expect(missingSource.is_error).toBe(true)
    expect(missingSource.content).toContain('Missing new_source')

    const invalidShape = await handler.execute(
      { id: 'e4', name: 'NotebookEdit', input: { notebook_path: tmp, cell_id: 'a', new_source: 'x' } },
      { cwd: process.cwd(), agentDepth: 0, replMode: 'acceptEdits' },
    )
    expect(invalidShape.is_error).toBe(true)
    expect(invalidShape.content).toContain('missing cells[]')

    await fsp.unlink(tmp)
  })

  it('validates insert/delete/replace target requirements', async () => {
    const handler = createNotebookEditToolHandler()
    const tmp = path.join(os.tmpdir(), `formax-notebook-${Date.now()}-target.ipynb`)
    const nb = makeNotebook([{ id: 'a', cell_type: 'markdown', metadata: {}, source: ['# a\n'] }])
    await fsp.writeFile(tmp, JSON.stringify(nb), 'utf8')

    const insertNeedType = await handler.execute(
      {
        id: 't1',
        name: 'NotebookEdit',
        input: { notebook_path: tmp, new_source: 'x', edit_mode: 'insert' },
      } as any,
      { cwd: process.cwd(), agentDepth: 0, replMode: 'acceptEdits' },
    )
    expect(insertNeedType.is_error).toBe(true)

    const missingCellId = await handler.execute(
      {
        id: 't2',
        name: 'NotebookEdit',
        input: { notebook_path: tmp, new_source: 'x', edit_mode: 'replace' },
      } as any,
      { cwd: process.cwd(), agentDepth: 0, replMode: 'acceptEdits' },
    )
    expect(missingCellId.is_error).toBe(true)

    const notFound = await handler.execute(
      {
        id: 't3',
        name: 'NotebookEdit',
        input: { notebook_path: tmp, cell_id: 'nope', new_source: 'x', edit_mode: 'replace' },
      },
      { cwd: process.cwd(), agentDepth: 0, replMode: 'acceptEdits' },
    )
    expect(notFound.is_error).toBe(true)
    expect(notFound.content).toContain('cell_id not found')

    await fsp.unlink(tmp)
  })

  it('stringifies non-Error exceptions in catch', async () => {
    const handler = createNotebookEditToolHandler()
    const tmp = path.join(os.tmpdir(), `formax-notebook-${Date.now()}-throw.ipynb`)
    await fsp.writeFile(tmp, JSON.stringify(makeNotebook([])), 'utf8')
    const spy = vi.spyOn(fsp, 'readFile').mockImplementationOnce(async () => {
      throw 'boom'
    })

    const result = await handler.execute(
      {
        id: 'x',
        name: 'NotebookEdit',
        input: { notebook_path: tmp, cell_id: 'a', new_source: 'x' },
      },
      { cwd: process.cwd(), agentDepth: 0, replMode: 'acceptEdits' },
    )
    expect(result.is_error).toBe(true)
    expect(result.content).toContain('Error: boom')

    spy.mockRestore()
    await fsp.unlink(tmp)
  })

  it('initializes code cell outputs/execution_count on replace when missing', async () => {
    const handler = createNotebookEditToolHandler()
    const tmp = path.join(os.tmpdir(), `formax-notebook-${Date.now()}-code-replace.ipynb`)
    const nb = makeNotebook([
      { id: 'c1', cell_type: 'code', metadata: {}, source: ['print(1)\n'] },
    ])
    await fsp.writeFile(tmp, JSON.stringify(nb), 'utf8')

    const result = await handler.execute(
      {
        id: 'code1',
        name: 'NotebookEdit',
        input: { notebook_path: tmp, cell_id: 'c1', new_source: 'print(2)', edit_mode: 'replace' },
      },
      { cwd: process.cwd(), agentDepth: 0, replMode: 'acceptEdits' },
    )
    expect(result.is_error).toBeUndefined()

    const updated = JSON.parse(await fsp.readFile(tmp, 'utf8'))
    expect(updated.cells[0].outputs).toEqual([])
    expect(updated.cells[0].execution_count).toBeNull()
    expect(updated.cells[0].source.join('')).toContain('print(2)')
    await fsp.unlink(tmp)
  })

  it('keeps existing code outputs/execution_count and supports multi-line source with trailing newline', async () => {
    const handler = createNotebookEditToolHandler()
    const tmp = path.join(os.tmpdir(), `formax-notebook-${Date.now()}-code-existing.ipynb`)
    const nb = makeNotebook([
      {
        id: 'c2',
        cell_type: 'code',
        metadata: {},
        source: ['old\n'],
        outputs: [{ output_type: 'stream', name: 'stdout', text: 'x' }],
        execution_count: 3,
      },
      { cell_type: 'markdown', metadata: {}, source: ['untagged\n'] },
    ])
    await fsp.writeFile(tmp, JSON.stringify(nb), 'utf8')

    const result = await handler.execute(
      {
        id: 'code2',
        name: 'NotebookEdit',
        input: { notebook_path: tmp, cell_id: 'c2', new_source: 'line1\nline2\n', edit_mode: 'replace', cell_type: 'code' },
      },
      { cwd: '' as any, agentDepth: 0, replMode: 'acceptEdits' },
    )
    expect(result.is_error).toBeUndefined()

    const updated = JSON.parse(await fsp.readFile(tmp, 'utf8'))
    expect(updated.cells[0].cell_type).toBe('code')
    expect(updated.cells[0].outputs).toEqual([{ output_type: 'stream', name: 'stdout', text: 'x' }])
    expect(updated.cells[0].execution_count).toBe(3)
    expect(updated.cells[0].source).toEqual(['line1\n', 'line2\n', '\n'])

    // Ensure a cell without id does not interfere with id-based lookup branching.
    expect(updated.cells[1].id).toBeUndefined()
    await fsp.unlink(tmp)
  })

  it('checks id-less cells while searching by id', async () => {
    const handler = createNotebookEditToolHandler()
    const tmp = path.join(os.tmpdir(), `formax-notebook-${Date.now()}-idless.ipynb`)
    const nb = makeNotebook([{ cell_type: 'markdown', metadata: {}, source: ['x\n'] }])
    await fsp.writeFile(tmp, JSON.stringify(nb), 'utf8')

    const result = await handler.execute(
      {
        id: 'idless1',
        name: 'NotebookEdit',
        input: { notebook_path: tmp, cell_id: 'missing', new_source: 'x', edit_mode: 'delete' },
      },
      { cwd: process.cwd(), agentDepth: 0, replMode: 'acceptEdits' },
    )
    expect(result.is_error).toBe(true)
    expect(result.content).toContain('cell_id not found')

    await fsp.unlink(tmp)
  })
})
