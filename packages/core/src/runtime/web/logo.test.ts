import { describe, expect, it } from 'vitest'
import { renderWebLogo, WEB_LOGO_LINES } from './logo.js'

describe('renderWebLogo', () => {
  it('renders logo lines with TUI-matching ANSI color', () => {
    const rendered = renderWebLogo()
    expect(rendered).toContain('\u001b[38;2;213;116;85m')
    expect(rendered).toContain('\u001b[39m')
    expect(rendered).toContain(WEB_LOGO_LINES[1])
    expect(rendered.endsWith('\n')).toBe(true)
  })
})
