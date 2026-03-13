import type { ToolDefinition } from '../../types'

/**
 * Tool spec for KillShell.
 *
 * This is the single source of truth for this tool's specification.
 * It should match the corresponding entry in packages/core/src/tools/specs/reference/tools-copy.json
 * (verified by parity tests).
 */
export const spec: ToolDefinition = {
  name: 'KillShell',
  description: '\n- Kills a running background bash shell by its ID\n- Takes a shell_id parameter identifying the shell to kill\n- Returns a success or failure status \n- Use this tool when you need to terminate a long-running shell\n- Shell IDs can be found using the /tasks command\n',
  input_schema: {
    type: 'object',
    properties: {
      shell_id: {
        type: 'string',
        description: 'The ID of the background shell to kill',
      },
    },
    required: ['shell_id'],
    additionalProperties: false,
    $schema: 'http://json-schema.org/draft-07/schema#',
  },
}
