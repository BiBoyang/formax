export type LlmProvider = 'anthropic' | 'openai' | 'unknown'

export function getKnownContextWindowTokens(args: {
  provider: LlmProvider
  model: string
}): number | null {
  const model = (args.model || '').trim()
  if (!model) return null

  if (args.provider === 'anthropic') {
    // Claude 3/3.5 family (observed + widely documented) is 200k context.
    if (model.startsWith('claude-3')) return 200_000
    return null
  }

  if (args.provider === 'openai') {
    if (model.startsWith('gpt-4o')) return 128_000
    if (model.startsWith('gpt-4-turbo')) return 128_000
    if (model.startsWith('gpt-3.5-turbo')) return 16_385
    // Avoid guessing for newer reasoning models until we have firm sources.
    return null
  }

  return null
}

