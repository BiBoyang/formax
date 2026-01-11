import { describe, expect, it } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import { createNodeFileStore } from '../adapters/fs/nodeFileStore'
import { loadRuntimeConfig } from './config'

describe('loadRuntimeConfig', () => {
  it('loads global/project config.json and applies precedence', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-env-config-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')

      await store.writeJsonAtomic(path.join(globalConfigDir, 'config.json'), { version: 1, ui: { promptProfile: 'lite' } })
      await store.writeJsonAtomic(path.join(projectDir, '.formax', 'config.json'), { version: 1, ui: { promptProfile: 'full' } })

      const cfg = await loadRuntimeConfig({ FORMAX_CONFIG_DIR: globalConfigDir } as any, projectDir)
      expect(cfg.ui.promptProfile).toBe('full')
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})

