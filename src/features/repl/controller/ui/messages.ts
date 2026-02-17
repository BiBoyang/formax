import type { Msg } from '../../../../components/tool/ToolMessage'

export function isTransientMessage(msg: Msg): boolean {
  return (msg.role === 'tool' && msg.toolInfo?.status === 'running') || Boolean(msg.isStreaming)
}

export function partitionMessages(messages: Msg[]): { staticMessages: Msg[]; transientMessages: Msg[] } {
  return {
    staticMessages: messages.filter((m) => !isTransientMessage(m)),
    transientMessages: messages.filter((m) => isTransientMessage(m)),
  }
}

