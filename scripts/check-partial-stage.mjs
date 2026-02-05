import { execSync } from 'node:child_process'

function sh(cmd) {
  return execSync(cmd, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    // Avoid "maxBuffer exceeded" when a repo has a huge list of changed files.
    maxBuffer: 10 * 1024 * 1024,
  })
}

function list(cmd) {
  const out = sh(cmd)
  if (!out) return []

  // Only normalize CRLF and remove the trailing newline, don't trim spaces from filenames.
  const lines = out.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  return lines.map((s) => s.replace(/\r$/, '')).filter((s) => s.length > 0)
}

// A file that is both staged and unstaged is a classic source of confusion:
// tests/review may run against a different version than what gets committed.
const staged = new Set(list('git diff --name-only --cached'))
const unstaged = new Set(list('git diff --name-only'))

const partial = [...staged].filter((f) => unstaged.has(f)).sort()

if (partial.length > 0) {
  // Keep output concise: list file paths only.
  process.stderr.write(
    [
      'Error: partial staging detected (files have both staged and unstaged changes):',
      ...partial.map((f) => `- ${f}`),
      '',
      'Fix: either stage everything for these files, or unstage them before continuing.',
      '',
    ].join('\n'),
  )
  process.exit(1)
}
