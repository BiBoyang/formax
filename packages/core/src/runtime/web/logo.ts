export const WEB_LOGO_LINES = [
  '             ',
  '█▀▀ █▀█ █▀█ █▀▄▀█ ▄▀█ ▀▄▀',
  '█▀  █▄█ █▀▄ █ ▀ █ █▀█ █ █',
  '             ',
]

const LOGO_COLOR_START = '\u001b[38;2;213;116;85m'
const LOGO_COLOR_END = '\u001b[39m'

export function renderWebLogo(): string {
  return `${LOGO_COLOR_START}${WEB_LOGO_LINES.join('\n')}${LOGO_COLOR_END}\n`
}
