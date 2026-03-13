export type ToolDefinition = {
  name: string
  description: string
  input_schema: unknown
  defer_loading?: boolean
}

export type ToolCall = {
  id: string
  name: string
  input: Record<string, unknown>
}

export type ToolResult = {
  tool_use_id: string
  content: ToolResultContent
  is_error?: boolean
  // Optional additional text blocks appended after tool_result in the next model call.
  extraTextBlocks?: string[]
}

export type ToolResultTextBlock = {
  type: 'text'
  text: string
}

export type ToolReferenceBlock = {
  type: 'tool_reference'
  tool_name: string
  // Backward-compatible alias for older payloads/tests; prefer `tool_name`.
  name?: string
  description?: string
  input_schema?: unknown
  defer_loading?: boolean
}

export type ToolResultContentBlock =
  | ToolResultTextBlock
  | ToolReferenceBlock
  | Record<string, unknown>

export type ToolResultContent = string | ToolResultContentBlock[]
