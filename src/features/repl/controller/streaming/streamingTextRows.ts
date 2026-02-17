import type { Msg } from '../../../../components/tool/ToolMessage'

export function createAssistantStreamingMessage(args: {
  assistantId: string
  text: string
}): Msg {
  return {
    id: args.assistantId,
    role: 'assistant',
    content: args.text,
    timestamp: new Date(),
    isStreaming: true,
  }
}

export function appendAssistantDeltaToMessages(args: {
  previous: Msg[]
  assistantId: string
  text: string
}): Msg[] {
  return args.previous.map((message) =>
    message.id === args.assistantId
      ? {
          ...message,
          content: message.content + args.text,
          isStreaming: true,
        }
      : message,
  )
}

export function finalizeAssistantStreamInMessages(args: {
  previous: Msg[]
  assistantId: string
}): Msg[] {
  return args.previous.map((message) =>
    message.id === args.assistantId
      ? {
          ...message,
          isStreaming: false,
        }
      : message,
  )
}

export function createThinkingBlockMessage(args: {
  thinkingId: string
  text: string
}): Msg {
  return {
    id: args.thinkingId,
    role: 'assistant',
    ui: { kind: 'thinking_block' },
    content: args.text,
    timestamp: new Date(),
  }
}

export function updateThinkingBlockContent(args: {
  previous: Msg[]
  thinkingId: string
  text: string
}): Msg[] {
  return args.previous.map((message) =>
    message.id === args.thinkingId
      ? {
          ...message,
          content: args.text,
        }
      : message,
  )
}
