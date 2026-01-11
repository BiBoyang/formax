export type JsonEnvelope =
  | {
      schemaVersion: 1
      command: string
      ok: true
      data: unknown
      warnings?: string[]
    }
  | {
      schemaVersion: 1
      command: string
      ok: false
      error: { message: string }
      warnings?: string[]
    }

export function toJson(value: unknown): string {
  return JSON.stringify(value, null, 2) + '\n'
}

