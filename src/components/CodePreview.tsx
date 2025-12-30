import React from 'react'
import { Box, Text } from 'ink'
import type { ThemeName } from '../utils/theme'
import { getTheme } from '../utils/theme'

type CodePreviewProps = {
  theme?: ThemeName
  width?: number
}

// Use theme system instead of hardcoded palettes

const codeLines = [
  { line: 1, code: 'function greet() {', type: 'normal' as const },
  { line: 2, code: '  console.log("Hello, World!");', type: 'remove' as const },
  { line: 2, code: '  console.log("Hello, anon!");', type: 'add' as const },
  { line: 3, code: '}', type: 'normal' as const },
]

// 简化的代码预览组件
export function CodePreview({ theme = 'dark', width = 40 }: CodePreviewProps) {
  const themeObj = getTheme(theme)

  const padCode = (code: string) => {
    if (!width) {
      return code
    }
    return code.padEnd(Math.max(width, code.length), ' ')
  }

  return (
    <Box
      flexDirection="column"
      paddingLeft={1}
      marginRight={1}
      borderStyle="round"
      borderColor={themeObj.secondaryBorder}
    >
      {codeLines.map((item, index) => {
        const lineNumber = item.line.toString().padStart(2)
        const content = padCode(item.code)

        if (item.type === 'remove') {
          return (
            <Text key={`remove-${index}`}>
              <Text color={themeObj.secondaryText}>{lineNumber} </Text>
              <Text
                backgroundColor={themeObj.diff.removed}
                color={themeObj.text}
              >
                {content}
              </Text>
            </Text>
          )
        }

        if (item.type === 'add') {
          return (
            <Text key={`add-${index}`}>
              <Text color={themeObj.secondaryText}>{lineNumber} </Text>
              <Text
                backgroundColor={themeObj.diff.added}
                color={themeObj.text}
              >
                {content}
              </Text>
            </Text>
          )
        }

        return (
          <Text key={`normal-${index}`}>
            <Text color={themeObj.secondaryText}>{lineNumber} </Text>
            <Text color={themeObj.text}>{content}</Text>
          </Text>
        )
      })}
    </Box>
  )
}
