import { describe, expect, it } from 'vitest'
import { __localUiTestHooks } from './localUi.js'

describe('local Web UI runtime injection', () => {
  it('injects bridge URL and setup mode into the hosted HTML', () => {
    const html = '<html><head><title>Formax</title></head><body></body></html>'
    const injected = __localUiTestHooks.injectRuntimeConfig(html, 3777, 'token-123', 'allow')

    expect(injected).toContain('window.__FORMAX_BRIDGE_URL__')
    expect(injected).toContain('token-123')
    expect(injected).toContain('window.__FORMAX_SETUP_MODE__="allow"')
    expect(injected.indexOf('window.__FORMAX_SETUP_MODE__')).toBeLessThan(injected.indexOf('</head>'))
  })

  it('redacts HTTP setup status to the complete bit only', () => {
    const payload = __localUiTestHooks.httpSetupStatusPayload(({
      complete: true,
      effective: {
        provider: 'anthropic',
        baseUrl: 'https://api.example.com',
        model: 'secret-model',
        authRef: 'default',
        apiKeySource: 'auth_store',
      },
      warnings: ['warning'],
    }) as { complete?: unknown })

    expect(payload).toEqual({ schemaVersion: 1, complete: true })
    expect(JSON.stringify(payload)).not.toContain('api.example.com')
    expect(JSON.stringify(payload)).not.toContain('secret-model')
  })

  it('serves the SPA shell for extensionless base-path routes', () => {
    expect(__localUiTestHooks.shouldServeSpaIndexPath('/app')).toBe(true)
    expect(__localUiTestHooks.shouldServeSpaIndexPath('/app/')).toBe(true)
    expect(__localUiTestHooks.shouldServeSpaIndexPath('/app/setup')).toBe(true)
    expect(__localUiTestHooks.shouldServeSpaIndexPath('/__formax/setup/status')).toBe(false)
    expect(__localUiTestHooks.shouldServeSpaIndexPath('/assets/app.js')).toBe(false)
  })
})
