import { beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'

type ReactNodeLike = {
  type: any
  props?: Record<string, unknown>
}

function findElementByType(node: unknown, type: any): ReactNodeLike | null {
  if (!node) return null
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findElementByType(item, type)
      if (found) return found
    }
    return null
  }
  if (typeof node === 'object' && node !== null) {
    const el = node as ReactNodeLike
    if (el.type === type) return el
    return findElementByType(el.props?.children, type)
  }
  return null
}

const mocks = vi.hoisted(() => {
  const render = vi.fn()
  const createNodeFileStore = vi.fn(() => ({ kind: 'file-store' }))
  const testSetupConnection = vi.fn()
  const writeSetupFiles = vi.fn(async () => {})
  const createSafeInkStdout = vi.fn((stdout: unknown) => ({ safeStdout: stdout }))

  const InputScopeProvider = ({ children }: { children: React.ReactNode }) => children
  const UserInputProvider = ({ children }: { children: React.ReactNode }) => children
  const REPL = (_props: any) => null
  const SetupWizard = (_props: any) => null
  const TranscriptPerfScreen = (_props: any) => null

  return {
    render,
    createNodeFileStore,
    testSetupConnection,
    writeSetupFiles,
    createSafeInkStdout,
    InputScopeProvider,
    UserInputProvider,
    REPL,
    SetupWizard,
    TranscriptPerfScreen,
    setupMode: 'done' as 'done' | 'cancel' | 'missing-provider',
    lastSetupProps: null as any,
    lastRenderInstance: null as null | { unmount: ReturnType<typeof vi.fn> },
  }
})

vi.mock('ink', () => ({
  render: (node: unknown, options?: Record<string, unknown>) => mocks.render(node, options),
}))

vi.mock('../adapters/fs/nodeFileStore.js', () => ({
  createNodeFileStore: mocks.createNodeFileStore,
}))
vi.mock('../adapters/setup/connectionTest.js', () => ({
  testSetupConnection: mocks.testSetupConnection,
}))
vi.mock('../adapters/setup/writeSetupFiles.js', () => ({
  writeSetupFiles: mocks.writeSetupFiles,
}))
vi.mock('../features/repl/inputScopeContext.js', () => ({
  InputScopeProvider: mocks.InputScopeProvider,
}))
vi.mock('../tools/runtime/userInputContext.js', () => ({
  UserInputProvider: mocks.UserInputProvider,
}))
vi.mock('../screens/REPL.js', () => ({
  REPL: mocks.REPL,
}))
vi.mock('../screens/perf/TranscriptPerfScreen.js', () => ({
  TranscriptPerfScreen: mocks.TranscriptPerfScreen,
}))
vi.mock('../tui/SetupWizard.js', () => ({
  SetupWizard: mocks.SetupWizard,
}))
vi.mock('../tui/inkStreams.js', () => ({
  createSafeInkStdout: mocks.createSafeInkStdout,
}))

import {
  renderLegacyReplApp,
  renderTranscriptPerfEntry,
  runLegacySetupWizard,
} from './runtimeUiBridge.js'

describe('runtimeUiBridge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.setupMode = 'done'
    mocks.lastSetupProps = null
    mocks.lastRenderInstance = null

    mocks.render.mockImplementation((node: unknown) => {
      const instance = { unmount: vi.fn() }
      mocks.lastRenderInstance = instance

      const setup = findElementByType(node, mocks.SetupWizard)
      if (setup?.props) {
        mocks.lastSetupProps = setup.props
        queueMicrotask(async () => {
          if (!mocks.lastSetupProps) return
          if (mocks.setupMode === 'done') {
            await mocks.lastSetupProps.onWrite({
              provider: 'openai',
              baseUrl: 'https://example.com/v1',
              apiKey: 'key',
              model: 'gpt-4o-mini',
              tierModels: { fast: 'gpt-4o-mini' },
              contextWindowTokens: 8192,
            })
            mocks.lastSetupProps.onDone()
            return
          }
          if (mocks.setupMode === 'missing-provider') {
            try {
              await mocks.lastSetupProps.onWrite({ provider: undefined })
            } catch {
              // expected branch
            }
          }
          mocks.lastSetupProps.onCancel()
        })
      }

      return instance
    })
  })

  it('renderLegacyReplApp renders REPL with providers and safe stdout', () => {
    const engine = { send: vi.fn() }
    const toolRegistry = { getHandlers: vi.fn() }
    const taskManager = { get: vi.fn() }
    const userInputManager = { isPending: vi.fn() }

    const out = renderLegacyReplApp({
      engine: engine as any,
      tools: [{ name: 'Read' } as any],
      cfg: { ui: { outputStyle: 'default' } } as any,
      initialSession: null,
      allowedSubagents: [{ name: 'reviewer', description: 'review' }],
      reloadSubagents: vi.fn(async () => []),
      toolRegistry: toolRegistry as any,
      taskManager: taskManager as any,
      userInputManager: userInputManager as any,
      onClearTerminal: vi.fn(async () => {}),
      onExit: vi.fn(),
    })

    expect(out).toBe(mocks.lastRenderInstance)
    expect(mocks.createSafeInkStdout).toHaveBeenCalledWith(process.stdout)
    expect(mocks.render).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ exitOnCtrlC: false, stdout: { safeStdout: process.stdout } }),
    )

    const root = mocks.render.mock.calls[0][0]
    const scopeProvider = findElementByType(root, mocks.InputScopeProvider)
    expect(scopeProvider?.props?.initialScope).toBe('repl')
    const replEl = findElementByType(root, mocks.REPL)
    expect(replEl).not.toBe(null)
    expect(replEl?.props?.engine).toBe(engine)
    expect(replEl?.props?.toolRegistry).toBe(toolRegistry)
    expect(replEl?.props?.taskManager).toBe(taskManager)
    expect(replEl?.props?.initialSession).toBeUndefined()
  })

  it('runLegacySetupWizard writes setup files on done and resolves', async () => {
    mocks.setupMode = 'done'
    await expect(runLegacySetupWizard({ cwd: '/repo', env: { FORMAX_CONFIG_DIR: '/cfg' } })).resolves.toBeUndefined()

    expect(mocks.createNodeFileStore).toHaveBeenCalledTimes(1)
    expect(mocks.writeSetupFiles).toHaveBeenCalledWith({
      fileStore: { kind: 'file-store' },
      cwd: '/repo',
      env: { FORMAX_CONFIG_DIR: '/cfg' },
      provider: 'openai',
      baseUrl: 'https://example.com/v1',
      apiKey: 'key',
      model: 'gpt-4o-mini',
      tierModels: { fast: 'gpt-4o-mini' },
      contextWindowTokens: 8192,
    })
    expect(mocks.lastSetupProps.testConnection).toBe(mocks.testSetupConnection)
    expect(mocks.lastRenderInstance?.unmount).toHaveBeenCalledTimes(1)
  })

  it('runLegacySetupWizard rejects when canceled', async () => {
    mocks.setupMode = 'cancel'
    await expect(runLegacySetupWizard({ cwd: '/repo', env: {} })).rejects.toThrow('Setup canceled')
    expect(mocks.lastRenderInstance?.unmount).toHaveBeenCalledTimes(1)
  })

  it('runLegacySetupWizard executes missing-provider validation branch', async () => {
    mocks.setupMode = 'missing-provider'
    await expect(runLegacySetupWizard({ cwd: '/repo', env: {} })).rejects.toThrow('Setup canceled')
    expect(mocks.writeSetupFiles).not.toHaveBeenCalled()
  })

  it('renders transcript perf entrypoint with exitOnCtrlC disabled', () => {
    mocks.render.mockClear()
    renderTranscriptPerfEntry({ count: 123, onExit: vi.fn() })
    const root = mocks.render.mock.calls[0][0]
    const perfEl = findElementByType(root, mocks.TranscriptPerfScreen)
    expect(perfEl).not.toBe(null)
    expect(perfEl?.props?.count).toBe(123)
    expect(mocks.render.mock.calls[0][1]).toEqual({ exitOnCtrlC: false })
  })
})
