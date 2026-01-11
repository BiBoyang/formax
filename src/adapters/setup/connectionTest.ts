import { fetchAnthropicModels } from '../../services/models.js'
import { ErrorCode } from '../../core/errors/codes.js'
import { mapUnknownError } from '../../core/setup/errorMapping.js'
import type { ProviderId } from '../../core/config/schema.js'
import type { ConnectionTestResult } from '../../core/setup/types.js'

export async function testSetupConnection(args: {
  provider: ProviderId
  baseUrl: string
  apiKey: string
}): Promise<ConnectionTestResult> {
  const provider = args.provider

  if (provider === 'anthropic') {
    try {
      const models = await fetchAnthropicModels(args.apiKey, args.baseUrl)
      return { ok: true, models: models.map((m) => m.model).filter(Boolean) }
    } catch (err) {
      const mapped = mapUnknownError(err)
      return { ok: false, code: mapped.code, message: mapped.message }
    }
  }

  if (provider === 'openai') {
    return { ok: false, code: ErrorCode.SetupRequired, message: 'OpenAI setup is not implemented yet.' }
  }

  if (provider === 'gemini') {
    return { ok: false, code: ErrorCode.SetupRequired, message: 'Gemini setup is not implemented yet.' }
  }

  return { ok: false, code: ErrorCode.Unknown, message: `Unknown provider: ${String(provider)}` }
}

