import type { ToolDefinition } from '../../types'
import type { ToolModule } from '../../registry'
import type { UserInputManager } from '../../runtime/userInputManager'
import { createAskUserQuestionToolHandler } from './handler'
import { AskUserQuestionToolPresenter } from './presenter'

const spec: ToolDefinition = {
  name: 'AskUserQuestion',
  description:
    'Ask the user clarifying questions during execution and return their answers.',
  input_schema: {
    type: 'object',
    properties: {
      questions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            question: {
              type: 'string',
              description:
                'The complete question to ask the user. Should be clear, specific, and end with a question mark.',
            },
            header: {
              type: 'string',
              description: 'Very short label displayed as a chip/tag (max 12 chars).',
            },
            options: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  label: {
                    type: 'string',
                    description:
                      'The display text for this option that the user will see and select.',
                  },
                  description: {
                    type: 'string',
                    description: 'Explanation of what this option means.',
                  },
                },
                required: ['label', 'description'],
                additionalProperties: false,
              },
              minItems: 2,
              maxItems: 4,
              description:
                "The available choices for this question. Must have 2-4 options. There should be no 'Other' option.",
            },
            multiSelect: {
              type: 'boolean',
              description:
                'Set to true to allow the user to select multiple options instead of just one.',
            },
          },
          required: ['question', 'header', 'options', 'multiSelect'],
          additionalProperties: false,
        },
        minItems: 1,
        maxItems: 4,
        description: 'Questions to ask the user (1-4 questions).',
      },
      answers: {
        type: 'object',
        additionalProperties: { type: 'string' },
        description: 'User answers collected by the UI.',
      },
    },
    required: ['questions'],
    additionalProperties: false,
    $schema: 'http://json-schema.org/draft-07/schema#',
  },
}

export function createAskUserQuestionToolModule(userInput: UserInputManager): ToolModule {
  return {
    name: 'AskUserQuestion',
    handler: createAskUserQuestionToolHandler(userInput),
    presenter: AskUserQuestionToolPresenter,
    specOverride: spec,
    meta: { interactive: true },
  }
}
