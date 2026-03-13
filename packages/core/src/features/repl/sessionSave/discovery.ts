import fsp from 'node:fs/promises'
import path from 'node:path'

async function collectSessionCandidates(args: {
  root: string
  includeFlatRootFiles: boolean
}): Promise<string[]> {
  const candidates: string[] = []
  const rootEntries = await fsp.readdir(args.root, { withFileTypes: true }).catch(() => [])

  if (args.includeFlatRootFiles) {
    for (const entry of rootEntries) {
      if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        candidates.push(path.join(args.root, entry.name))
      }
    }
  }

  for (const yearEntry of rootEntries) {
    if (!yearEntry.isDirectory()) continue
    const yearDir = path.join(args.root, yearEntry.name)
    const monthEntries = await fsp.readdir(yearDir, { withFileTypes: true }).catch(() => [])
    for (const monthEntry of monthEntries) {
      if (!monthEntry.isDirectory()) continue
      const monthDir = path.join(yearDir, monthEntry.name)
      const dayEntries = await fsp.readdir(monthDir, { withFileTypes: true }).catch(() => [])
      for (const dayEntry of dayEntries) {
        if (!dayEntry.isDirectory()) continue
        const dayDir = path.join(monthDir, dayEntry.name)
        const fileEntries = await fsp.readdir(dayDir, { withFileTypes: true }).catch(() => [])
        for (const fileEntry of fileEntries) {
          if (!fileEntry.isFile()) continue
          if (!fileEntry.name.endsWith('.jsonl')) continue
          candidates.push(path.join(dayDir, fileEntry.name))
        }
      }
    }
  }

  return candidates
}

export {
  collectSessionCandidates,
}

