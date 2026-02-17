import type { Msg } from '../../../../components/tool/ToolMessage'
import type { StreamEvent } from '../../../../streaming/types'

export function createRunningToolMessage(args: {
  toolMsgId: string
  toolUseId: string
  toolName: string
}): Msg {
  return {
    id: args.toolMsgId,
    role: 'tool',
    content: '',
    timestamp: new Date(),
    toolInfo: {
      name: args.toolName,
      toolUseId: args.toolUseId,
      input: {},
      status: 'running',
    },
  }
}

export function applyLegacyToolInputToMessages(args: {
  previous: Msg[]
  toolMsgId: string
  input: unknown
}): Msg[] {
  return args.previous.map((message) =>
    message.id === args.toolMsgId
      ? {
          ...message,
          toolInfo: {
            ...message.toolInfo!,
            input: args.input as any,
          },
        }
      : message,
  )
}

export function applyLegacyToolUpdateToMessages(args: {
  previous: Msg[]
  toolMsgId: string
  toolName: string | undefined
  event: Extract<StreamEvent, { type: 'tool_update' }>
}): Msg[] {
  const { event } = args
  return args.previous.map((message) =>
    message.id === args.toolMsgId
      ? {
          ...message,
          toolInfo: {
            ...message.toolInfo!,
            ...(event.middleLines ? { middleLines: event.middleLines } : {}),
            ...(event.transcriptLines ? { transcriptLines: event.transcriptLines } : {}),
            ...(event.nestedTools ? { nestedTools: event.nestedTools } : {}),
            ...(args.toolName === 'Task' && typeof event.toolUses === 'number' ? { toolUses: event.toolUses } : {}),
            ...(args.toolName === 'Task' && event.usage ? { usage: event.usage } : {}),
          },
        }
      : message,
  )
}
