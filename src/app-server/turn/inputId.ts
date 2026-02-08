import type { InputKind } from '../protocol/input.js'

export function createInputId(args: { turnId: string; toolUseId: string; kind: InputKind }): string {
  return `${args.turnId}:${args.toolUseId}:${args.kind}`
}
