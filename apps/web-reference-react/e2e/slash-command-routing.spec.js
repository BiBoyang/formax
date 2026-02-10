import { expect, test } from '@playwright/test'
import { installMockRpc } from './helpers/mockRpc'

function recentIso() {
  return new Date(Date.now() - 45_000).toISOString()
}

test.describe('slash command routing', () => {
  test('keeps web command handling bounded to /init /clear /compact /todos', async ({ page }) => {
    const updatedAt = recentIso()
    await installMockRpc(page, {
      threads: [
        {
          id: 'thread-cmd',
          cwd: '/tmp/formax',
          createdAt: updatedAt,
          updatedAt,
          messageCount: 2,
          lastUserPrompt: 'hello',
          label: 'Thread Cmd',
        },
      ],
      threadMessages: {
        'thread-cmd': {
          __null__: {
            data: [{ id: 'm1', kind: 'message', role: 'assistant', text: 'ready' }],
            nextCursor: null,
          },
        },
      },
      commandDispatchResults: {
        '/init': {
          command: '/init',
          dispatched: true,
          turn: { id: 'turn-init-1', threadId: 'thread-cmd', status: 'running' },
        },
        '/todos': {
          command: '/todos',
          dispatched: true,
          local: { stdout: 'No todos currently tracked' },
        },
        '/compact': {
          command: '/compact',
          dispatched: true,
          turn: { id: 'turn-compact-1', threadId: 'thread-cmd', status: 'running' },
        },
      },
    })

    await page.goto('/')
    await page.getByRole('button', { name: /Thread Cmd/i }).click()
    await expect(page.getByText('ready')).toBeVisible()

    const input = page.getByPlaceholder('Ask for follow-up changes')
    const send = page.getByLabel('Send message')

    await input.fill('/init')
    await send.click()
    await expect(page.getByText('/init')).toBeVisible()

    await input.fill('/todos')
    await send.click()
    await expect(page.getByText('No todos currently tracked')).toBeVisible()

    await input.fill('/clear')
    await send.click()

    await input.fill('/compact')
    await send.click()

    await input.fill('/help')
    await send.click()
    await expect(page.getByText('Web reference does not support /help yet. Please use TUI for this command.')).toBeVisible()

    const requests = await page.evaluate(() => window.__mockRpcState?.requests || [])
    const methods = requests.map((entry) => String(entry.method || ''))
    expect(methods.filter((method) => method === 'command/dispatch').length).toBe(3)
    expect(methods.filter((method) => method === 'thread/start').length).toBe(1)

    const commandPayloads = requests
      .filter((entry) => String(entry.method || '') === 'command/dispatch')
      .map((entry) => entry.params?.command)
    expect(commandPayloads).toEqual(['/init', '/todos', '/compact'])

    const turnStartPayloads = requests
      .filter((entry) => String(entry.method || '') === 'turn/start')
      .map((entry) => entry.params?.input?.text)
    expect(turnStartPayloads).not.toContain('/init')
    expect(turnStartPayloads).not.toContain('/todos')
    expect(turnStartPayloads).not.toContain('/help')
  })
})
