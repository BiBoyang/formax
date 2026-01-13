import { spawn } from 'node:child_process'
import path from 'node:path'

export async function createTarGz(args: {
  sourceDir: string
  outPath: string
}): Promise<void> {
  const sourceDir = String(args.sourceDir || '').trim()
  const outPath = String(args.outPath || '').trim()
  if (!sourceDir) throw new Error('Missing sourceDir')
  if (!outPath) throw new Error('Missing outPath')

  const parent = path.dirname(sourceDir)
  const base = path.basename(sourceDir)

  await new Promise<void>((resolve, reject) => {
    const child = spawn('tar', ['-czf', outPath, '-C', parent, base], {
      stdio: 'ignore',
    })
    child.once('error', (err) => reject(err))
    child.once('exit', (code, signal) => {
      if (signal) return reject(new Error(`tar exited with signal ${signal}`))
      if (code !== 0) return reject(new Error(`tar exited with code ${code}`))
      resolve()
    })
  })
}

