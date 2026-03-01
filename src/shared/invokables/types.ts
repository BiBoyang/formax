export type InvokableKind = 'command' | 'skill'
export type InvokableScope = 'project' | 'user'

export type InvokableMeta = {
  kind: InvokableKind
  scope: InvokableScope
  name: string
  description: string
  argumentHint?: string
  disableModelInvocation?: boolean
  sourcePath?: string
}

