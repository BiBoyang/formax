export type TurnProvider = 'openai' | 'anthropic'

export function resolveTurnProvider(provider: string): TurnProvider {
  if (provider === 'openai' || provider === 'anthropic') return provider
  throw new Error(`Unsupported provider "${provider}" for REPL turns. Supported providers: anthropic, openai.`)
}
