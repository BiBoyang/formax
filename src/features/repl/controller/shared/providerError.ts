import type { Dispatch, SetStateAction } from 'react'
import type { Msg } from '../../../../components/tool/ToolMessage'

export function applyProviderErrorToState(args: {
  providerError: string
  setError: Dispatch<SetStateAction<string | null>>
  setMessages: Dispatch<SetStateAction<Msg[]>>
}): void {
  args.setError(args.providerError)
  args.setMessages((prev) => [
    ...prev,
    {
      id: `error-${Date.now()}`,
      role: 'assistant',
      ui: { kind: 'command_subline' as const },
      content: args.providerError,
      timestamp: new Date(),
    },
  ])
}
