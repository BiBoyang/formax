import type { ToolDefinition } from '../../types'

/**
 * Tool spec for ExitPlanMode.
 *
 * This is the single source of truth for this tool's specification.
 * It should match the corresponding entry in src/tools/specs/reference/tools-copy.json
 * (verified by parity tests).
 */
export const spec: ToolDefinition = {
  name: 'ExitPlanMode',
  description: 'Use this tool when you are in plan mode and have finished writing your plan to the plan file and are ready for user approval.\n\n## How This Tool Works\n- You should have already written your plan to the plan file specified in the plan mode system message\n- This tool does NOT take the plan content as a parameter - it will read the plan from the file you wrote\n- This tool simply signals that you\'re done planning and ready for the user to review and approve\n- The user will see the contents of your plan file when they review it\n\n## When to Use This Tool\nIMPORTANT: Only use this tool when the task requires planning the implementation steps of a task that requires writing code. For research tasks where you\'re gathering information, searching files, reading files or in general trying to understand the codebase - do NOT use this tool.\n\n## Handling Ambiguity in Plans\nBefore using this tool, ensure your plan is clear and unambiguous. If there are multiple valid approaches or unclear requirements:\n1. Use the AskUserQuestion tool to clarify with the user\n2. Ask about specific implementation choices (e.g., architectural patterns, which library to use)\n3. Clarify any assumptions that could affect the implementation\n4. Edit your plan file to incorporate user feedback\n5. Only proceed with ExitPlanMode after resolving ambiguities and updating the plan file\n\n## Examples\n\n1. Initial task: "Search for and understand the implementation of vim mode in the codebase" - Do not use the exit plan mode tool because you are not planning the implementation steps of a task.\n2. Initial task: "Help me implement yank mode for vim" - Use the exit plan mode tool after you have finished planning the implementation steps of the task.\n3. Initial task: "Add a new feature to handle user authentication" - If unsure about auth method (OAuth, JWT, etc.), use AskUserQuestion first, then use exit plan mode tool after clarifying the approach.',
  input_schema: {
    type: 'object',
    properties: {
      launchSwarm: {
        type: 'boolean',
        description: 'Whether to launch a swarm to implement the plan',
      },
      teammateCount: {
        type: 'number',
        description: 'Number of teammates to spawn in the swarm',
      },
    },
    additionalProperties: true,
    $schema: 'http://json-schema.org/draft-07/schema#',
  },
}
