// Model definitions aligned with Kode-cli project
// Only providers with model definitions (even if empty) will be shown in the provider selection

export default {
  openai: [
    {
      model: 'gpt-4o',
      max_tokens: 16384,
      supports_reasoning_effort: false,
      supports_vision: true,
      supports_function_calling: true,
    },
    {
      model: 'gpt-4-turbo',
      max_tokens: 4096,
      supports_reasoning_effort: false,
      supports_vision: true,
      supports_function_calling: true,
    },
    {
      model: 'gpt-4',
      max_tokens: 4096,
      supports_reasoning_effort: false,
      supports_vision: false,
      supports_function_calling: true,
    },
    {
      model: 'gpt-3.5-turbo',
      max_tokens: 4096,
      supports_reasoning_effort: false,
      supports_vision: false,
      supports_function_calling: true,
    },
  ],
  anthropic: [
    {
      model: 'claude-3-5-sonnet-latest',
      max_tokens: 8192,
      supports_reasoning_effort: false,
      supports_vision: true,
      supports_function_calling: true,
    },
    {
      model: 'claude-3-5-haiku-latest',
      max_tokens: 8192,
      supports_reasoning_effort: false,
      supports_vision: true,
      supports_function_calling: true,
    },
    {
      model: 'claude-3-opus-latest',
      max_tokens: 4096,
      supports_reasoning_effort: false,
      supports_vision: true,
      supports_function_calling: true,
    },
  ],
  deepseek: [
    {
      model: 'deepseek-chat',
      max_tokens: 4096,
      supports_reasoning_effort: false,
      supports_vision: false,
      supports_function_calling: true,
    },
    {
      model: 'deepseek-coder',
      max_tokens: 4096,
      supports_reasoning_effort: false,
      supports_vision: false,
      supports_function_calling: true,
    },
    {
      model: 'deepseek-reasoner',
      max_tokens: 4096,
      supports_reasoning_effort: false,
      supports_vision: false,
      supports_function_calling: true,
    },
  ],
  kimi: [
    {
      model: 'kimi-k2-0711-preview',
      max_tokens: 16384,
      supports_reasoning_effort: false,
      supports_vision: false,
      supports_function_calling: true,
    },
  ],
  qwen: [], // Empty array - provider exists but no predefined models
  glm: [],
  minimax: [],
  'baidu-qianfan': [],
  siliconflow: [],
  ollama: [],
  burncloud: [],
  'minimax-coding': [],
  'glm-coding': [],
}

