import { describe, expect, it, vi } from 'vitest'
import { taskSubAgentTestExports } from './taskSubAgent'

describe('taskSubAgent helpers', () => {
  it('parses explicit model tiers and errors', () => {
    expect(taskSubAgentTestExports.parseExplicitModelTier(undefined)).toEqual({})
    expect(taskSubAgentTestExports.parseExplicitModelTier('')).toEqual({})
    expect(taskSubAgentTestExports.parseExplicitModelTier('   ')).toEqual(
      expect.objectContaining({ error: expect.stringContaining('model must be one of') }),
    )
    expect(taskSubAgentTestExports.parseExplicitModelTier('haiku')).toEqual({ tier: 'haiku' })
    expect(taskSubAgentTestExports.parseExplicitModelTier('gpt-4o')).toEqual(
      expect.objectContaining({ error: expect.stringContaining('Unsupported model') }),
    )
  })

  it('compacts tool inputs and formats nested headers', () => {
    expect(
      taskSubAgentTestExports.compactInputForHeader('Write', { file_path: '/tmp/a/b/c.txt', other: 1 }),
    ).toMatchObject({ file_path: 'c.txt', other: 1 })
    expect(
      taskSubAgentTestExports.compactInputForHeader('NotebookEdit', { notebook_path: '/tmp/p/n.ipynb' }),
    ).toMatchObject({ notebook_path: 'n.ipynb' })
    expect(
      taskSubAgentTestExports.compactInputForHeader('Edit', { path: '/tmp/a/b/c.ts' }),
    ).toMatchObject({ path: 'c.ts' })

    expect(
      taskSubAgentTestExports.compactInputForNestedUi('Bash', {
        command: 'ls',
        cwd: '/tmp',
        timeout: 100,
        run_in_background: true,
        description: 'desc',
        ignored: 1,
      }),
    ).toEqual({
      command: 'ls',
      cwd: '/tmp',
      timeout: 100,
      run_in_background: true,
      description: 'desc',
    })
    expect(
      taskSubAgentTestExports.compactInputForNestedUi('Write', {
        file_path: 'a.ts',
        path: 'b.ts',
      }),
    ).toEqual({ file_path: 'a.ts', path: 'b.ts' })
    expect(taskSubAgentTestExports.compactInputForNestedUi('Write', { file_path: 1 as any })).toEqual({})
    expect(
      taskSubAgentTestExports.compactInputForNestedUi('Edit', {
        path: 'c.ts',
      }),
    ).toEqual({ path: 'c.ts' })
    expect(
      taskSubAgentTestExports.compactInputForNestedUi('Task', {
        subagent_type: 'coder',
        description: 'd',
        prompt: 'p',
        run_in_background: false,
        x: 1,
      }),
    ).toEqual({
      subagent_type: 'coder',
      description: 'd',
      prompt: 'p',
      run_in_background: false,
    })
    expect(
      taskSubAgentTestExports.compactInputForNestedUi('NotebookEdit', {
        notebook_path: 'n.ipynb',
        cell_id: '1',
        cell_type: 'code',
        edit_mode: 'replace',
      }),
    ).toEqual({
      notebook_path: 'n.ipynb',
      cell_id: '1',
      cell_type: 'code',
      edit_mode: 'replace',
    })
    expect(taskSubAgentTestExports.compactInputForNestedUi('NotebookEdit', { cell_id: 1 as any })).toEqual({})
    expect(
      taskSubAgentTestExports.compactInputForNestedUi('AskUserQuestion', {
        questions: [{ question: 'q' }],
        ignored: true,
      }),
    ).toEqual({ questions: [{ question: 'q' }] })
    expect(taskSubAgentTestExports.compactInputForNestedUi('AskUserQuestion', { questions: 'x' as any })).toEqual({})
    expect(taskSubAgentTestExports.compactInputForNestedUi('Unknown', { x: 1 })).toEqual({ x: 1 })
    expect(taskSubAgentTestExports.compactInputForHeader('' as any, {})).toEqual({})
    expect(taskSubAgentTestExports.compactInputForNestedUi('' as any, {})).toEqual({})
    expect(
      taskSubAgentTestExports.compactInputForNestedUi('Task', {
        subagent_type: 1 as any,
        description: 2 as any,
        prompt: 3 as any,
        run_in_background: 'no' as any,
      }),
    ).toEqual({})

    const header = taskSubAgentTestExports.formatNestedHeader('Read', { file_path: '/tmp/x/y/z.md' })
    expect(header).toContain('Read')
    expect(header).toContain('z.md')
  })

  it('renders nested lines, transcript lines and nested result lines', () => {
    const entries = [
      {
        id: '1',
        name: 'Read',
        input: {},
        status: 'completed' as const,
        header: 'Read(path: a.ts)',
        summary: 'read done',
        rawResult: '',
      },
      {
        id: '2',
        name: 'Grep',
        input: {},
        status: 'error' as const,
        header: 'Grep(pattern: x)',
        summary: 'grep failed',
        rawResult: 'a.ts\nb.ts\n',
      },
      {
        id: '3',
        name: 'Write',
        input: {},
        status: 'running' as const,
        header: 'Write(file_path: out.txt)',
      },
    ]

    const nested = taskSubAgentTestExports.renderNestedLines(entries as any, 5)
    expect(nested.length).toBeGreaterThan(0)
    expect(nested.join('\n')).toContain('more tool uses')

    const transcript = taskSubAgentTestExports.renderTaskTranscriptLines({
      taskPrompt: 'line1\nline2',
      entries: entries as any,
      responseText: 'response',
      doneLine: 'Done (1 tool use · 10 tokens · 1s)',
    })
    expect(transcript.join('\n')).toContain('Prompt:')
    expect(transcript.join('\n')).toContain('Response:')
    expect(transcript[transcript.length - 1]).toContain('Done')

    const blankHeaderTranscript = taskSubAgentTestExports.renderTaskTranscriptLines({
      taskPrompt: '',
      entries: [{ ...entries[0], header: '   ' }] as any,
      responseText: 'x'.repeat(12_000),
      doneLine: '',
    })
    expect(blankHeaderTranscript.join('\n')).toContain('chars truncated')

    const nestedResult = taskSubAgentTestExports.renderNestedToolResultLines(entries[1] as any)
    expect(nestedResult.join('\n')).toContain('a.ts')

    const withExpandInfo = taskSubAgentTestExports.renderNestedToolResultLines({
      id: '4',
      name: 'Read',
      input: {},
      status: 'completed',
      header: 'Read(file_path: a.ts)',
      rawResult:
        "Read lines 1-2 of 3 from a.ts\n\n1→const x = 1;\n2→const y = 2;\nUse offset to read more lines",
    } as any)
    expect(withExpandInfo.join('\n')).toContain('Read')

    const bashExpand = taskSubAgentTestExports.renderNestedToolResultLines({
      id: '5',
      name: 'Bash',
      input: {},
      status: 'completed',
      header: 'Bash(command: x)',
      rawResult: 'l1\nl2\nl3\nl4\nl5',
    } as any)
    expect(bashExpand.join('\n')).toContain('ctrl+o to expand')

    const missingRaw = taskSubAgentTestExports.renderNestedToolResultLines({
      id: '6',
      name: '',
      input: {},
      status: 'completed',
      header: 'Unknown()',
      rawResult: undefined as any,
    } as any)
    expect(Array.isArray(missingRaw)).toBe(true)

    const promptFirstLineFallback = taskSubAgentTestExports.renderTaskTranscriptLines({
      taskPrompt: '\nline2',
      entries: [],
      responseText: '',
    })
    expect(promptFirstLineFallback.join('\n')).toContain('\n>')

    const emptyBlockTranscript = taskSubAgentTestExports.renderTaskTranscriptLines({
      taskPrompt: '',
      entries: [{ id: 'x', name: 'Unknown', input: {}, status: 'completed', header: 'Unknown()', rawResult: '' }] as any,
      responseText: '',
    })
    expect(emptyBlockTranscript.join('\n')).toContain('Unknown()')
  })

  it('covers utility helpers and throttled updater', () => {
    expect(taskSubAgentTestExports.basename('/a/b/c.txt')).toBe('c.txt')
    expect(taskSubAgentTestExports.basename('')).toBe('')
    expect(taskSubAgentTestExports.toSingleLine('a \n\t b')).toBe('a b')
    expect(taskSubAgentTestExports.truncateLine('abcdef', 4)).toBe('abc…')
    expect(taskSubAgentTestExports.splitLines('a\r\nb')).toEqual(['a', 'b'])
    expect(taskSubAgentTestExports.truncateTextByChars('abcdef', 4)).toEqual({
      preview: 'abcd',
      truncated: 2,
    })
    expect(taskSubAgentTestExports.truncateTextByChars(undefined as any, 4)).toEqual({
      preview: '',
      truncated: 0,
    })
    expect(
      taskSubAgentTestExports.sumTokens({
        input_tokens: 1,
        output_tokens: 2,
        cache_read_input_tokens: 3,
        cache_creation_input_tokens: 4,
      }),
    ).toBe(10)
    expect(taskSubAgentTestExports.sumTokens(undefined)).toBe(0)
    expect(taskSubAgentTestExports.formatTokenCount(0)).toBe('')
    expect(taskSubAgentTestExports.formatTokenCount(999)).toBe('999')
    expect(taskSubAgentTestExports.formatTokenCount(1200)).toBe('1.2k')
    expect(taskSubAgentTestExports.formatTokenCount(120000)).toBe('120k')
    expect(taskSubAgentTestExports.formatTokenCount(2000000)).toBe('2.0m')
    expect(taskSubAgentTestExports.formatTokenCount(Number.NaN)).toBe('')
    expect(taskSubAgentTestExports.formatDuration(500)).toBe('1s')
    expect(taskSubAgentTestExports.formatDuration(60_000)).toBe('1m')
    expect(taskSubAgentTestExports.formatDuration(61_000)).toBe('1m 1s')
    expect(taskSubAgentTestExports.formatDuration(Number.NaN)).toBe('0s')
    expect(taskSubAgentTestExports.toSingleLine(undefined as any)).toBe('')

    const usage: Record<string, number> = {}
    taskSubAgentTestExports.addUsage(usage as any, {
      input_tokens: 2,
      output_tokens: 3,
      cache_read_input_tokens: 4,
      cache_creation_input_tokens: 5,
    })
    expect(usage).toMatchObject({
      input_tokens: 2,
      output_tokens: 3,
      cache_read_input_tokens: 4,
      cache_creation_input_tokens: 5,
    })

    const arr = Array.from({ length: 205 }, (_, i) => ({ id: String(i) }))
    taskSubAgentTestExports.trimEntries(arr as any)
    expect(arr.length).toBe(200)

    vi.useFakeTimers()
    const fn = vi.fn()
    const schedule = taskSubAgentTestExports.createThrottledUpdater(fn)
    schedule()
    schedule()
    expect(fn).toHaveBeenCalledTimes(0)
    vi.advanceTimersByTime(120)
    expect(fn).toHaveBeenCalledTimes(1)
    schedule()
    schedule.flush()
    expect(fn).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })
})
