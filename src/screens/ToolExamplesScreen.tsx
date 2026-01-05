/**
 * ToolExamplesScreen
 * 
 * A debugging screen that displays various tool UI states for development
 * and testing purposes. This screen showcases all tool types in different
 * states (running, completed, error) with realistic examples.
 * 
 * @module ToolExamplesScreen
 */

import React from 'react'
import { Box, Text, useInput } from 'ink'
import { ToolMessage, Msg } from '../components/tool/ToolMessage'

type Props = {
  onExit?: () => void
}

/**
 * Example tool messages demonstrating various tool types and states
 */
const exampleMessages: Msg[] = [
  // === Read Tool Examples ===
  {
    id: 'read-running',
    role: 'tool',
    content: '',
    timestamp: new Date(),
    toolInfo: {
      name: 'Read',
      input: { file_path: 'src/components/Button.tsx' },
      status: 'running'
    }
  },
  {
    id: 'read-completed',
    role: 'tool',
    content: 'Read 156 lines',
    timestamp: new Date(),
    toolInfo: {
      name: 'Read',
      input: { file_path: 'src/components/Button.tsx' },
      status: 'completed',
      resultLines: 156
    }
  },
  {
    id: 'read-error',
    role: 'tool',
    content: 'Error: File not found: src/missing.ts',
    timestamp: new Date(),
    toolInfo: {
      name: 'Read',
      input: { file_path: 'src/missing.ts' },
      status: 'error'
    }
  },

  // === Write Tool Examples ===
  {
    id: 'write-running',
    role: 'tool',
    content: '',
    timestamp: new Date(),
    toolInfo: {
      name: 'Write',
      input: { file_path: 'output.txt' },
      status: 'running'
    }
  },
  {
    id: 'write-completed',
    role: 'tool',
    content: 'Wrote 42 lines to output.txt',
    timestamp: new Date(),
    toolInfo: {
      name: 'Write',
      input: { file_path: 'output.txt' },
      status: 'completed',
      resultLines: 42
    }
  },

  // === Edit Tool Examples ===
  {
    id: 'edit-completed',
    role: 'tool',
    content: 'Applied 3 edits to src/index.ts',
    timestamp: new Date(),
    toolInfo: {
      name: 'Edit',
      input: { file_path: 'src/index.ts' },
      status: 'completed'
    }
  },

  // === Bash Tool Examples ===
  {
    id: 'bash-running',
    role: 'tool',
    content: '',
    timestamp: new Date(),
    toolInfo: {
      name: 'Bash',
      input: { command: 'npm run build' },
      status: 'running'
    }
  },
  {
    id: 'bash-single-line',
    role: 'tool',
    content: 'Build completed successfully',
    timestamp: new Date(),
    toolInfo: {
      name: 'Bash',
      input: { command: 'npm run build' },
      status: 'completed',
      resultLines: 1
    }
  },
  {
    id: 'bash-multi-line',
    role: 'tool',
    content: 'total 0',
    timestamp: new Date(),
    toolInfo: {
      name: 'Bash',
      input: { command: 'ls -la src/' },
      status: 'completed',
      resultLines: 12,
      middleLines: [
        'drwxr-xr-x  11 david  staff   352  1  5 21:21 .',
        'drwxr-xr-x  22 david  staff   704  1  5 21:42 ..'
      ],
      expandInfo: '… +9 lines (ctrl+o to expand)'
    }
  },
  {
    id: 'bash-error',
    role: 'tool',
    content: 'Error: Command failed with exit code 1',
    timestamp: new Date(),
    toolInfo: {
      name: 'Bash',
      input: { command: 'npm run nonexistent' },
      status: 'error'
    }
  },

  // === Glob Tool Examples ===
  {
    id: 'glob-running',
    role: 'tool',
    content: '',
    timestamp: new Date(),
    toolInfo: {
      name: 'Glob',
      input: { pattern: '**/*.tsx' },
      status: 'running'
    }
  },
  {
    id: 'glob-completed',
    role: 'tool',
    content: 'Found 24 files',
    timestamp: new Date(),
    toolInfo: {
      name: 'Glob',
      input: { pattern: '**/*.tsx' },
      status: 'completed',
      resultLines: 24
    }
  },

  // === Grep Tool Examples ===
  {
    id: 'grep-completed',
    role: 'tool',
    content: 'Found 8 matches',
    timestamp: new Date(),
    toolInfo: {
      name: 'Grep',
      input: { pattern: 'TODO', path: 'src/' },
      status: 'completed',
      resultLines: 8
    }
  },

  // === Search Tool Examples ===
  {
    id: 'search-completed',
    role: 'tool',
    content: 'Found 3 files',
    timestamp: new Date(),
    toolInfo: {
      name: 'Search',
      input: { pattern: 'useCallback' },
      status: 'completed',
      resultLines: 3
    }
  },

  // === Edge Cases ===
  {
    id: 'edge-empty-result',
    role: 'tool',
    content: '',
    timestamp: new Date(),
    toolInfo: {
      name: 'Bash',
      input: { command: 'echo ""' },
      status: 'completed',
      resultLines: 0
    }
  },
  {
    id: 'edge-long-command',
    role: 'tool',
    content: 'Command executed successfully',
    timestamp: new Date(),
    toolInfo: {
      name: 'Bash',
      input: { command: 'npm run build && npm run test && npm run lint && npm run format' },
      status: 'completed'
    }
  },
  {
    id: 'edge-unicode',
    role: 'tool',
    content: 'Read 10 lines',
    timestamp: new Date(),
    toolInfo: {
      name: 'Read',
      input: { file_path: 'src/文件/测试.ts' },
      status: 'completed',
      resultLines: 10
    }
  },
  {
    id: 'edge-special-chars',
    role: 'tool',
    content: 'Found 2 files',
    timestamp: new Date(),
    toolInfo: {
      name: 'Glob',
      input: { pattern: 'src/[test]/*.tsx' },
      status: 'completed',
      resultLines: 2
    }
  }
]

/**
 * ToolExamplesScreen Component
 * 
 * Displays a scrollable list of tool UI examples for debugging and development.
 * Press 'q' or Ctrl+C to exit.
 */
export function ToolExamplesScreen({ onExit }: Props): React.ReactNode {
  useInput((key, meta) => {
    if (key === 'q' || (meta.ctrl && key === 'c')) {
      onExit ? onExit() : process.exit(0)
    }
  })

  return (
    <Box flexDirection="column" padding={1}>
      {/* Header */}
      <Box marginBottom={1}>
        <Text bold color="cyan">Tool UI Examples</Text>
      </Box>
      <Box marginBottom={1}>
        <Text dimColor>
          This screen displays various tool UI states for debugging purposes.
          Press 'q' to exit.
        </Text>
      </Box>

      {/* Section: Read Tool */}
      <Box marginTop={1}>
        <Text bold underline>Read Tool</Text>
      </Box>
      {exampleMessages.filter(m => m.toolInfo?.name === 'Read').map(msg => (
        <ToolMessage key={msg.id} message={msg} />
      ))}

      {/* Section: Write Tool */}
      <Box marginTop={1}>
        <Text bold underline>Write Tool</Text>
      </Box>
      {exampleMessages.filter(m => m.toolInfo?.name === 'Write').map(msg => (
        <ToolMessage key={msg.id} message={msg} />
      ))}

      {/* Section: Edit Tool */}
      <Box marginTop={1}>
        <Text bold underline>Edit Tool</Text>
      </Box>
      {exampleMessages.filter(m => m.toolInfo?.name === 'Edit').map(msg => (
        <ToolMessage key={msg.id} message={msg} />
      ))}

      {/* Section: Bash Tool */}
      <Box marginTop={1}>
        <Text bold underline>Bash Tool</Text>
      </Box>
      {exampleMessages.filter(m => m.toolInfo?.name === 'Bash').map(msg => (
        <ToolMessage key={msg.id} message={msg} />
      ))}

      {/* Section: Glob Tool */}
      <Box marginTop={1}>
        <Text bold underline>Glob Tool</Text>
      </Box>
      {exampleMessages.filter(m => m.toolInfo?.name === 'Glob').map(msg => (
        <ToolMessage key={msg.id} message={msg} />
      ))}

      {/* Section: Grep Tool */}
      <Box marginTop={1}>
        <Text bold underline>Grep Tool</Text>
      </Box>
      {exampleMessages.filter(m => m.toolInfo?.name === 'Grep').map(msg => (
        <ToolMessage key={msg.id} message={msg} />
      ))}

      {/* Section: Search Tool */}
      <Box marginTop={1}>
        <Text bold underline>Search Tool</Text>
      </Box>
      {exampleMessages.filter(m => m.toolInfo?.name === 'Search').map(msg => (
        <ToolMessage key={msg.id} message={msg} />
      ))}

      {/* Section: Edge Cases */}
      <Box marginTop={1}>
        <Text bold underline>Edge Cases</Text>
      </Box>
      {exampleMessages.filter(m => m.id.startsWith('edge-')).map(msg => (
        <ToolMessage key={msg.id} message={msg} />
      ))}

      {/* Footer */}
      <Box marginTop={2}>
        <Text dimColor>Press 'q' to exit</Text>
      </Box>
    </Box>
  )
}

export default ToolExamplesScreen
export { exampleMessages }
