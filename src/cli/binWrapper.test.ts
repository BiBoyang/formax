import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

describe('bin/formax.js wrapper', () => {
  it('does not exit immediately after spawning dist CLI', () => {
    const __filename = fileURLToPath(import.meta.url)
    const __dirname = path.dirname(__filename)
    const repoRoot = path.resolve(__dirname, '../..')
    const wrapperPath = path.join(repoRoot, 'bin', 'formax.js')
    const wrapper = fs.readFileSync(wrapperPath, 'utf8')

    expect(wrapper).not.toContain('process.exit(0)')
    expect(wrapper).not.toContain('entrypoints')
    expect(wrapper).not.toContain('cli.tsx')
    expect(wrapper).not.toContain('resolveTsxCli')
    expect(wrapper).not.toContain("require.resolve('tsx")

    expect(wrapper).toContain("path.join(repoRoot, 'dist', 'cli.js')")
    expect(wrapper).toContain("spawn(process.execPath, [distCli, ...args], { stdio: 'inherit' })")
    expect(wrapper).toContain('wireChildProcess(child)')
  })
})
