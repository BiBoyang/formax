import type { ToolDefinition } from '../../types'

/**
 * Tool spec for Skill.
 *
 * This is the single source of truth for this tool's specification.
 * It should match the corresponding entry in src/tools/specs/reference/tools-copy.json
 * (verified by parity tests).
 */
export const baseSpec: ToolDefinition = {
  name: 'Skill',
  description: 'Execute a skill within the main conversation\n\n<skills_instructions>\nWhen users ask you to perform tasks, check if any of the available skills below can help complete the task more effectively. Skills provide specialized capabilities and domain knowledge.\n\nHow to invoke:\n- Use this tool with the skill name only (no arguments)\n- Examples:\n  - `skill: "pdf"` - invoke the pdf skill\n  - `skill: "xlsx"` - invoke the xlsx skill\n  - `skill: "ms-office-suite:pdf"` - invoke using fully qualified name\n\nImportant:\n- When a skill is relevant, you must invoke this tool IMMEDIATELY as your first action\n- NEVER just announce or mention a skill in your text response without actually calling this tool\n- This is a BLOCKING REQUIREMENT: invoke the relevant Skill tool BEFORE generating any other response about the task\n- Only use skills listed in <available_skills> below\n- Do not invoke a skill that is already running\n- Do not use this tool for built-in CLI commands (like /help, /clear, etc.)\n</skills_instructions>\n\n<available_skills>\n\n</available_skills>\n',
  input_schema: {
    type: 'object',
    properties: {
      skill: {
        type: 'string',
        description: 'The skill name (no arguments). E.g., "pdf" or "xlsx"',
      },
    },
    required: ['skill'],
    additionalProperties: false,
    $schema: 'http://json-schema.org/draft-07/schema#',
  },
}
