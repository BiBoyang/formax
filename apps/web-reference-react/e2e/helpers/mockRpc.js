/**
 * Install an in-browser JSON-RPC bridge mock by overriding `window.WebSocket`.
 * This keeps Playwright tests deterministic and independent from app-server.
 */
export async function installMockRpc(page, scenario) {
  await page.addInitScript(
    ({ scenarioValue }) => {
      const scenarioConfig = scenarioValue || {}
      const state = {
        requests: [],
        submissions: [],
      }

      const deferred = new Set()

      const nextTick = (fn) => {
        const timer = setTimeout(() => {
          deferred.delete(timer)
          fn()
        }, 0)
        deferred.add(timer)
      }

      const keyForCursor = (cursor) => (cursor == null ? '__null__' : String(cursor))

      const resolveRequest = (message) => {
        const method = String(message.method || '')
        const params = message.params || {}

        switch (method) {
          case 'initialize':
            return {
              serverInfo: { name: 'mock-app-server', version: '0.0.0-test' },
            }
          case 'thread/list':
            return {
              data: Array.isArray(scenarioConfig.threads) ? scenarioConfig.threads : [],
            }
          case 'thread/start':
            return {
              thread: scenarioConfig.threadStart || { id: 'thread-new' },
            }
          case 'thread/messages': {
            const threadId = String(params.threadId || '')
            const cursor = keyForCursor(params.cursor)
            const table = (scenarioConfig.threadMessages || {})[threadId] || {}
            const pageData = table[cursor] || { data: [], nextCursor: null }
            return {
              data: Array.isArray(pageData.data) ? pageData.data : [],
              nextCursor: typeof pageData.nextCursor === 'string' ? pageData.nextCursor : null,
            }
          }
          case 'turn/start':
            return {
              turn: scenarioConfig.turnStart || { id: 'turn-test-1' },
            }
          case 'turn/interrupt':
            return {
              ok: true,
            }
          case 'bridge/readDiff':
            return (
              scenarioConfig.diffSnapshot || {
                cwd: '/tmp/formax',
                generatedAt: new Date().toISOString(),
                hasChanges: false,
                truncated: false,
                files: [],
              }
            )
          case 'turn/input/submit':
            state.submissions.push(params)
            return scenarioConfig.submitResult || { status: 'submitted' }
          default:
            return {}
        }
      }

      const emitNotifications = (socket, notifications) => {
        if (!Array.isArray(notifications)) return
        for (const notification of notifications) {
          const delayMs = Number(notification?.delayMs ?? 0)
          const payload = {
            jsonrpc: '2.0',
            method: notification?.method,
            params: notification?.params,
          }
          const emit = () => {
            if (typeof socket.onmessage === 'function') {
              socket.onmessage({ data: JSON.stringify(payload) })
            }
          }
          if (delayMs > 0) {
            const timer = setTimeout(() => {
              deferred.delete(timer)
              emit()
            }, delayMs)
            deferred.add(timer)
          } else {
            nextTick(emit)
          }
        }
      }

      class MockWebSocket {
        static CONNECTING = 0
        static OPEN = 1
        static CLOSING = 2
        static CLOSED = 3

        constructor(url) {
          this.url = String(url || '')
          this.readyState = MockWebSocket.CONNECTING
          this.onopen = null
          this.onclose = null
          this.onerror = null
          this.onmessage = null

          nextTick(() => {
            this.readyState = MockWebSocket.OPEN
            if (typeof this.onopen === 'function') {
              this.onopen({ type: 'open' })
            }
          })
        }

        send(raw) {
          if (this.readyState !== MockWebSocket.OPEN) return

          let message = null
          try {
            message = JSON.parse(String(raw))
          } catch {
            if (typeof this.onerror === 'function') {
              this.onerror(new Error('Invalid JSON'))
            }
            return
          }

          state.requests.push(message)

          if (message && Object.prototype.hasOwnProperty.call(message, 'id')) {
            const method = String(message.method || '')
            const result = resolveRequest(message)
            nextTick(() => {
              if (typeof this.onmessage === 'function') {
                this.onmessage({
                  data: JSON.stringify({
                    jsonrpc: '2.0',
                    id: message.id,
                    result,
                  }),
                })
              }
            })
            const byMethod = scenarioConfig.notificationsByRequestMethod || {}
            emitNotifications(this, byMethod[method] || byMethod['*'])
            return
          }

          if (message?.method === 'initialized') {
            const notifications = Array.isArray(scenarioConfig.notificationsOnInitialized)
              ? scenarioConfig.notificationsOnInitialized
              : []
            emitNotifications(
              this,
              notifications.map((entry) => ({
                method: entry?.method,
                params: entry?.params,
                delayMs: entry?.delayMs,
              })),
            )
          }
        }

        close() {
          this.readyState = MockWebSocket.CLOSED
          for (const timer of deferred) {
            clearTimeout(timer)
          }
          deferred.clear()
          nextTick(() => {
            if (typeof this.onclose === 'function') {
              this.onclose({ type: 'close' })
            }
          })
        }
      }

      window.__mockRpcState = state
      window.WebSocket = MockWebSocket
    },
    { scenarioValue: scenario },
  )
}
