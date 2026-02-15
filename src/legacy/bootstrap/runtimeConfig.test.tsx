import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const createNodeFileStore = vi.fn(() => ({ kind: 'file-store' }))
const loadRuntimeConfig = vi.fn()

let wizardAction: 'done' | 'cancel' = 'done'
const SetupWizard = vi.fn(() => null)

function findSetupWizardProps(node: unknown): Record<string, unknown> | null {
  if (!node || typeof node !== 'object') return null
  const element = node as { type?: unknown; props?: { children?: unknown } }
  if (element.type === SetupWizard) return (element.props ?? {}) as Record<string, unknown>
  const children = element.props?.children
  if (!children) return null
  if (Array.isArray(children)) {
    for (const child of children) {
      const found = findSetupWizardProps(child)
      if (found) return found
    }
    return null
  }
  return findSetupWizardProps(children)
}

const render = vi.fn((tree: unknown) => {
  const props = findSetupWizardProps(tree)
  if (props) {
    queueMicrotask(() => {
      if (wizardAction === 'cancel') {
        const onCancel = props.onCancel as (() => void) | undefined
        onCancel?.()
        return
      }
      const onDone = props.onDone as (() => void) | undefined
      onDone?.()
    })
  }

  return {
    unmount: vi.fn(),
    clear: vi.fn(),
  }
})

vi.mock('../../adapters/fs/nodeFileStore.js', () => ({
  createNodeFileStore,
}))
vi.mock('../../env/config.js', () => ({
  loadRuntimeConfig,
}))
vi.mock('ink', () => ({
  render,
}))
vi.mock('../../ui/SetupWizard.js', () => ({
  SetupWizard,
}))
vi.mock('../../adapters/setup/connectionTest.js', () => ({
  testSetupConnection: vi.fn(),
}))
vi.mock('../../adapters/setup/writeSetupFiles.js', () => ({
  writeSetupFiles: vi.fn(async () => {}),
}))

describe('createRuntimeConfigContext', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    wizardAction = 'done'
  })

  it('loads config once when api key exists', async () => {
    loadRuntimeConfig.mockResolvedValue({
      llm: { apiKey: 'key' },
    })
    const { createRuntimeConfigContext } = await import('./runtimeConfig.js')
    await createRuntimeConfigContext({ cwd: '/repo', env: process.env })

    expect(loadRuntimeConfig).toHaveBeenCalledTimes(1)
    expect(render).not.toHaveBeenCalled()
  })

  it('forces setup wizard when forceSetup=true', async () => {
    loadRuntimeConfig
      .mockResolvedValueOnce({ llm: { apiKey: 'key' } })
      .mockResolvedValueOnce({ llm: { apiKey: 'key' } })
    const { createRuntimeConfigContext } = await import('./runtimeConfig.js')
    await createRuntimeConfigContext({ cwd: '/repo', env: process.env, forceSetup: true })

    expect(render).toHaveBeenCalledTimes(1)
    expect(loadRuntimeConfig).toHaveBeenCalledTimes(2)
  })

  it('runs setup wizard then reloads config when key is missing', async () => {
    loadRuntimeConfig
      .mockResolvedValueOnce({ llm: { apiKey: '' } })
      .mockResolvedValueOnce({ llm: { apiKey: 'new-key' } })
    const { createRuntimeConfigContext } = await import('./runtimeConfig.js')
    await createRuntimeConfigContext({ cwd: '/repo', env: process.env })

    expect(render).toHaveBeenCalledTimes(1)
    expect(loadRuntimeConfig).toHaveBeenCalledTimes(2)
  })

  it('throws when setup wizard is canceled', async () => {
    wizardAction = 'cancel'
    loadRuntimeConfig.mockResolvedValue({ llm: { apiKey: '' } })
    const { createRuntimeConfigContext } = await import('./runtimeConfig.js')
    await expect(createRuntimeConfigContext({ cwd: '/repo', env: process.env })).rejects.toThrow('Setup canceled')
  })
})
