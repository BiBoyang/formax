import { sourceFromInputKind, type InputPromptSource } from './inputContracts'

export type RuntimeEventSource = InputPromptSource | 'engine' | 'system'

export function sourceFromRuntimeEventType(eventType: string): RuntimeEventSource {
  if (eventType === 'approval_request') return sourceFromInputKind('approval')
  if (eventType === 'ask_user_question') return sourceFromInputKind('ask_user_question')
  if (eventType.startsWith('tool_')) return 'tool'
  if (eventType === 'error') return 'system'
  return 'engine'
}
