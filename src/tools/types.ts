export type ToolDefinition = {
  name: string
  description: string
  input_schema: unknown
}

export type ToolCall = {
  id: string
  name: string
  input: Record<string, unknown>
}

export type ToolResult = {
  tool_use_id: string
  content: string
  is_error?: boolean
}

