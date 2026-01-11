export type JsonEnvelope =
  | {
      schemaVersion: 1
      command: string
      ok: true
      data: unknown
      warnings?: string[]
      meta?: Record<string, unknown>
    }
  | {
      schemaVersion: 1
      command: string
      ok: false
      error: { message: string }
      warnings?: string[]
      meta?: Record<string, unknown>
    }

export function toJson(value: unknown): string {
  return JSON.stringify(value, null, 2) + '\n'
}
