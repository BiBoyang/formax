import type { ToolDefinition } from '../../types'

/**
 * Tool spec for TaskOutput.
 *
 * This is the single source of truth for this tool's specification.
 * It should match the corresponding entry in packages/core/src/tools/specs/reference/tools-copy.json
 * (verified by parity tests).
 */
export const spec: ToolDefinition = {
  name: 'TaskOutput',
  description: '- Retrieves output from a running or completed task (background shell, agent, or remote session)\n- Takes a task_id parameter identifying the task\n- Returns the task output along with status information\n- Use block=true (default) to wait for task completion\n- Use block=false for non-blocking check of current status\n- Task IDs can be found using the /tasks command\n- Works with all task types: background shells, async agents, and remote sessions',
  input_schema: {
    type: 'object',
    properties: {
      task_id: {
        type: 'string',
        description: 'The task ID to get output from',
      },
      block: {
        type: 'boolean',
        default: true,
        description: 'Whether to wait for completion',
      },
      timeout: {
        type: 'number',
        minimum: 0,
        maximum: 600000,
        default: 30000,
        description: 'Max wait time in ms',
      },
    },
    required: ['task_id'],
    additionalProperties: false,
    $schema: 'http://json-schema.org/draft-07/schema#',
  },
}
