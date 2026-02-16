export type TurnProvider = 'openai' | 'anthropic'

export function resolveTurnProvider(provider: string): TurnProvider {
  return provider === 'openai' ? 'openai' : 'anthropic'
}

