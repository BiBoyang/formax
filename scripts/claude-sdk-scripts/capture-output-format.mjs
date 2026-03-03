import { query } from '@anthropic-ai/claude-agent-sdk'
const schema = {
  type: 'object',
  properties: {
    company_name: { type: 'string' },
    founded_year: { type: 'number' },
  },
  required: ['company_name'],
  additionalProperties: false,
}

const prompt =
  process.argv[2] ??
  'Return a JSON object only. company_name should be "Anthropic" and founded_year should be 2021.'
const REQUEST_TIMEOUT_MS = Number(process.env.CLAUDE_AGENT_SDK_TIMEOUT_MS || 30_000)

function normalizeAnthropicBaseUrl(url) {
  const raw = String(url || '').trim()
  if (!raw) return ''
  return raw.replace(/\/+$/, '').replace(/\/v1$/, '')
}

async function main() {
  const rawBaseUrl =
    process.env.CLAUDE_AGENT_SDK_BASE_URL_PROXY ||
    process.env.CLAUDE_AGENT_SDK_BASE_URL ||
    process.env.ANTHROPIC_BASE_URL ||
    ''

  const envForSdk = {
    ...process.env,
    ANTHROPIC_API_KEY:
      process.env.CLAUDE_AGENT_SDK_API_KEY ||
      process.env.ANTHROPIC_API_KEY ||
      '',
    ANTHROPIC_BASE_URL: normalizeAnthropicBaseUrl(rawBaseUrl),
  }

  if (!envForSdk.ANTHROPIC_API_KEY) {
    throw new Error('Missing API key. Set ANTHROPIC_API_KEY or CLAUDE_AGENT_SDK_API_KEY')
  }
  if (!envForSdk.ANTHROPIC_BASE_URL) {
    throw new Error('Missing base URL. Set ANTHROPIC_BASE_URL or CLAUDE_AGENT_SDK_BASE_URL(_PROXY)')
  }

  // Prefer explicit API-key flow; stale auth tokens can cause 401.
  delete envForSdk.ANTHROPIC_AUTH_TOKEN

  console.error('[capture] Using base URL from env (masked):', envForSdk.ANTHROPIC_BASE_URL)
  console.error('[capture] Timeout (ms):', REQUEST_TIMEOUT_MS)

  const messages = []
  for await (const message of query({
    prompt,
    options: {
      env: envForSdk,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      outputFormat: {
        type: 'json_schema',
        schema,
      },
    },
  })) {
    messages.push(message)
  }

  const result = messages.findLast((item) => item?.type === 'result')
  console.log(
    JSON.stringify(
      {
        totalMessages: messages.length,
        resultType: result?.type,
        subtype: result?.subtype,
        stopReason: result?.stop_reason ?? null,
        hasStructuredOutput: 'structured_output' in (result || {}),
        structuredOutput: result?.structured_output ?? null,
        error: result?.error ?? null,
      },
      null,
      2,
    ),
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
