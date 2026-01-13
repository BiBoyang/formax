import type { AuditEventV1 } from '../../core/audit/schema.js'

export interface AuditLog {
  append(event: AuditEventV1): Promise<void>
}

