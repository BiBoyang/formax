import { basename, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export type McpRoot = {
  uri: string
  name: string
}

export type McpRootsList = {
  roots: [McpRoot]
}

export function createSingleCwdMcpRootsList(cwd: string): McpRootsList {
  const resolved = resolve(cwd)
  return {
    roots: [{
      uri: pathToFileURL(resolved).href,
      name: basename(resolved) || resolved,
    }],
  }
}
