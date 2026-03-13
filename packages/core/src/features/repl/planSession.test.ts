import { describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createPlanSessionManager } from './planSession'

function createTempDir(): { dir: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'formax-plan-session-'))
  return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) }
}

describe('planSession', () => {
  it('startNewPlan creates an empty file and updates getPlanPath', () => {
    const { dir, cleanup } = createTempDir()
    try {
      const mgr = createPlanSessionManager({ planDir: dir })

      const planPath = mgr.startNewPlan()

      expect(mgr.getPlanPath()).toBe(planPath)
      expect(fs.statSync(planPath).isFile()).toBe(true)
    } finally {
      cleanup()
    }
  })

  it('falls back to plan-${Date.now()}.md when slug collides repeatedly', () => {
    const { dir, cleanup } = createTempDir()
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0)
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(123)

    try {
      const mgr = createPlanSessionManager({ planDir: dir })

      const collisionPath = path.join(dir, 'cheerful-cuddling-conway.md')
      fs.writeFileSync(collisionPath, 'x')

      const planPath = mgr.startNewPlan()

      expect(planPath).toBe(path.join(dir, 'plan-123.md'))
      expect(fs.statSync(planPath).isFile()).toBe(true)
    } finally {
      randomSpy.mockRestore()
      nowSpy.mockRestore()
      cleanup()
    }
  })

  it('does not throw when mkdir/open fail', () => {
    const { dir, cleanup } = createTempDir()
    const mkdirSpy = vi.spyOn(fs, 'mkdirSync').mockImplementation(() => {
      throw new Error('mkdir denied')
    })
    const openSpy = vi.spyOn(fs, 'openSync').mockImplementation(() => {
      throw new Error('open denied')
    })

    try {
      const mgr = createPlanSessionManager({ planDir: dir })

      expect(() => mgr.startNewPlan()).not.toThrow()
      expect(typeof mgr.getPlanPath()).toBe('string')
    } finally {
      mkdirSpy.mockRestore()
      openSpy.mockRestore()
      cleanup()
    }
  })
})

