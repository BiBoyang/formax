import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { installMockRpc } from './helpers/mockRpc'

const DEFAULT_TASK = 'TASK-0000-web-reference-acceptance'
const DEFAULT_PHASE = 'after'
const DEFAULT_LABEL = '01-acceptance'
const FIXED_UPDATED_AT = '2026-03-19T00:00:00.000Z'

function nowStamp() {
  return new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
}

function sanitizeSegment(value) {
  return value.trim().replaceAll(/[^\w-]/g, '-')
}

function evidenceFilePath() {
  const task = sanitizeSegment(process.env.EVIDENCE_TASK ?? DEFAULT_TASK)
  const phase = sanitizeSegment(process.env.EVIDENCE_PHASE ?? DEFAULT_PHASE)
  const label = sanitizeSegment(process.env.EVIDENCE_LABEL ?? DEFAULT_LABEL)
  const fileName = `${label}-${nowStamp()}.png`
  return path.join(process.cwd(), 'evidence', 'tasks', task, phase, fileName)
}

test('capture web reference acceptance screenshot', async ({ page }) => {
  test.skip(process.env.RUN_EVIDENCE !== 'true', 'Evidence screenshot is opt-in.')

  await installMockRpc(page, {
    threads: [
      {
        id: 'thread-evidence',
        cwd: '/tmp/formax-evidence',
        createdAt: FIXED_UPDATED_AT,
        updatedAt: FIXED_UPDATED_AT,
        messageCount: 3,
        lastUserPrompt: 'Capture evidence',
        label: 'Thread Evidence',
      },
    ],
    threadMessages: {
      'thread-evidence': {
        __null__: {
          data: [
            { id: 'm1', kind: 'message', role: 'user', text: 'run type-check' },
            {
              id: 't1',
              kind: 'tool',
              toolUseId: 'tool-evidence-1',
              toolName: 'Bash',
              status: 'completed',
              summary: 'Ran command for 1.8s',
              paramsText: 'command="bun run type-check"',
              detailLines: ['> bun run type-check'],
            },
            { id: 'm2', kind: 'message', role: 'assistant', text: 'ready for evidence capture' },
          ],
          nextCursor: null,
        },
      },
    },
    diffSnapshot: {
      cwd: '/tmp/formax-evidence',
      generatedAt: FIXED_UPDATED_AT,
      hasChanges: true,
      truncated: false,
      files: [
        {
          path: 'src/evidence/sample.ts',
          additions: 2,
          deletions: 1,
          patch: '@@ -1,1 +1,2 @@\n-old value\n+new value\n+evidence line',
        },
      ],
    },
  })

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page.getByRole('button', { name: /Thread Evidence/i }).click()

  await expect(page.getByText('ready for evidence capture')).toBeVisible()
  await expect(page.getByText('src/evidence/sample.ts')).toBeVisible()
  await expect(page.getByText('connected')).toBeVisible()

  await page.getByRole('button', { name: /^Bash$/ }).click()
  await expect(page.getByText('> bun run type-check')).toBeVisible()

  const outputPath = evidenceFilePath()
  mkdirSync(path.dirname(outputPath), { recursive: true })
  await page.screenshot({ path: outputPath, fullPage: true })
  console.log(`Evidence screenshot saved: ${outputPath}`)
})
