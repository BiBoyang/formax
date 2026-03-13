import fs from 'node:fs'
import path from 'node:path'

export type PlanSessionManager = {
  getPlanPath: () => string | null
  startNewPlan: () => string
}

const ADJ1 = [
  'cheerful',
  'concurrent',
  'curious',
  'goofy',
  'graceful',
  'happy',
  'playful',
  'polite',
  'precise',
  'quiet',
  'sorted',
  'staged',
  'steady',
  'thoughtful',
]

const ADJ2 = [
  'cuddling',
  'floating',
  'snacking',
  'whistling',
  'wibbling',
  'drifting',
  'gliding',
  'wandering',
]

const NAMES = [
  'conway',
  'dongarra',
  'lamport',
  'milner',
  'turing',
  'knuth',
  'shannon',
  'hopper',
]

function pick(list: string[]): string {
  const idx = Math.floor(Math.random() * list.length)
  return list[Math.min(list.length - 1, Math.max(0, idx))]!
}

function createPlanSlug(): string {
  return `${pick(ADJ1)}-${pick(ADJ2)}-${pick(NAMES)}`
}

function fileExists(filePath: string): boolean {
  try {
    fs.statSync(filePath)
    return true
  } catch {
    return false
  }
}

function ensurePlanFile(filePath: string): void {
  const dir = path.dirname(filePath)
  try {
    fs.mkdirSync(dir, { recursive: true })
  } catch {
    // ignore
  }

  try {
    const fd = fs.openSync(filePath, 'a')
    fs.closeSync(fd)
  } catch {
    // ignore
  }
}

export function createPlanSessionManager(args: { planDir: string }): PlanSessionManager {
  let currentPlanPath: string | null = null

  const startNewPlan = (): string => {
    const dir = args.planDir
    // Avoid collisions in case the name generator repeats.
    for (let i = 0; i < 20; i++) {
      const candidate = path.join(dir, `${createPlanSlug()}.md`)
      if (!fileExists(candidate)) {
        currentPlanPath = candidate
        ensurePlanFile(candidate)
        return candidate
      }
    }

    const fallback = path.join(dir, `plan-${Date.now()}.md`)
    currentPlanPath = fallback
    ensurePlanFile(fallback)
    return fallback
  }

  return {
    getPlanPath: () => currentPlanPath,
    startNewPlan,
  }
}
