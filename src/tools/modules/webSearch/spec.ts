import type { ToolDefinition } from '../../types'

/**
 * Tool spec for WebSearch.
 *
 * This is the single source of truth for this tool's specification.
 * It should match the corresponding entry in proxy/tools-copy.json
 * (verified by parity tests).
 */
export const spec: ToolDefinition = {
  name: 'WebSearch',
  description: '\n- Allows Claude to search the web and use the results to inform responses\n- Provides up-to-date information for current events and recent data\n- Returns search result information formatted as search result blocks, including links as markdown hyperlinks\n- Use this tool for accessing information beyond Claude\'s knowledge cutoff\n- Searches are performed automatically within a single API call\n\nCRITICAL REQUIREMENT - You MUST follow this:\n  - After answering the user\'s question, you MUST include a "Sources:" section at the end of your response\n  - In the Sources section, list all relevant URLs from the search results as markdown hyperlinks: [Title](URL)\n  - This is MANDATORY - never skip including sources in your response\n  - Example format:\n\n    [Your answer here]\n\n    Sources:\n    - [Source Title 1](https://example.com/1)\n    - [Source Title 2](https://example.com/2)\n\nUsage notes:\n  - Domain filtering is supported to include or block specific websites\n  - Web search is only available in the US\n\nIMPORTANT - Use the correct year in search queries:\n  - Today\'s date is 2026-01-05. You MUST use this year when searching for recent information, documentation, or current events.\n  - Example: If today is 2025-07-15 and the user asks for "latest React docs", search for "React documentation 2025", NOT "React documentation 2024"\n',
  input_schema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        minLength: 2,
        description: 'The search query to use',
      },
      allowed_domains: {
        type: 'array',
        items: {
          type: 'string',
        },
        description: 'Only include search results from these domains',
      },
      blocked_domains: {
        type: 'array',
        items: {
          type: 'string',
        },
        description: 'Never include search results from these domains',
      },
    },
    required: ['query'],
    additionalProperties: false,
    $schema: 'http://json-schema.org/draft-07/schema#',
  },
}
