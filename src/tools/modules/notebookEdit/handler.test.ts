import { describe, expect, it } from 'vitest'
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
  it('replaces a cell source by id', async () => {
    const handler = createNotebookEditToolHandler({
      requestAnswers: async () => {
        throw new Error('Unexpected prompt')
      },
      submitAnswers: () => true,
      reject: () => true,
      isPending: () => false,
    })
    const tmp = path.join(os.tmpdir(), `formax-notebook-${Date.now()}-1.ipynb`)
    const nb = makeNotebook([
      { id: 'a', cell_type: 'code', metadata: {}, source: ['print("old")\n'], outputs: [], execution_count: null },
    ])
    await fsp.writeFile(tmp, JSON.stringify(nb), 'utf8')

    const result = await handler.execute(
      {
        id: '1',
        name: 'NotebookEdit',
        input: { notebook_path: tmp, cell_id: 'a', new_source: 'print("new")' },
      },
      { cwd: process.cwd(), agentDepth: 0, replMode: 'acceptEdits' },
    )

    expect(result.is_error).toBeUndefined()
    const updated = JSON.parse(await fsp.readFile(tmp, 'utf8'))
    expect(updated.cells[0].source.join('')).toContain('print("new")')
    await fsp.unlink(tmp)
  })

  it('inserts a new cell after an id', async () => {
    const handler = createNotebookEditToolHandler({
      requestAnswers: async () => {
        throw new Error('Unexpected prompt')
      },
      submitAnswers: () => true,
      reject: () => true,
      isPending: () => false,
    })
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
        input: { notebook_path: tmp, cell_id: 'a', new_source: '# inserted', edit_mode: 'insert', cell_type: 'markdown' },
      },
      { cwd: process.cwd(), agentDepth: 0, replMode: 'acceptEdits' },
    )

    expect(result.is_error).toBeUndefined()
    const updated = JSON.parse(await fsp.readFile(tmp, 'utf8'))
    expect(updated.cells).toHaveLength(3)
    expect(updated.cells[1].cell_type).toBe('markdown')
    expect(updated.cells[1].source.join('')).toContain('# inserted')
    await fsp.unlink(tmp)
  })

  it('deletes a cell by id without requiring new_source', async () => {
    const handler = createNotebookEditToolHandler({
      requestAnswers: async () => {
        throw new Error('Unexpected prompt')
      },
      submitAnswers: () => true,
      reject: () => true,
      isPending: () => false,
    })
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
        input: { notebook_path: tmp, cell_id: 'a', edit_mode: 'delete' },
      },
      { cwd: process.cwd(), agentDepth: 0, replMode: 'acceptEdits' },
    )

    expect(result.is_error).toBeUndefined()
    const updated = JSON.parse(await fsp.readFile(tmp, 'utf8'))
    expect(updated.cells).toHaveLength(1)
    expect(updated.cells[0].id).toBe('b')
    await fsp.unlink(tmp)
  })
})
