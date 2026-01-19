import React from 'react'
import { Box, Text } from 'ink'

export type SelectListItem = {
  key: string
  label: string
  right?: string
}

export function SelectList({
  items,
  cursor,
  accentColor,
  mutedColor,
  activePrefix = '> ',
  inactivePrefix = '  ',
  showNumbers = true,
  leftWidth,
  rightColor,
}: {
  items: SelectListItem[]
  cursor: number
  accentColor: string
  mutedColor: string
  activePrefix?: string
  inactivePrefix?: string
  showNumbers?: boolean
  leftWidth?: number
  rightColor?: string
}): React.ReactNode {
  return (
    <Box flexDirection="column">
      {items.map((item, idx) => {
        const active = idx === cursor
        const prefix = active ? activePrefix : inactivePrefix
        const color = active ? accentColor : mutedColor
        const label = `${prefix}${showNumbers ? `${idx + 1}. ` : ''}${item.label}`

        if (!item.right) {
          return (
            <Text key={item.key} color={color}>
              {label}
            </Text>
          )
        }

        return (
          <Box key={item.key}>
            <Box width={leftWidth ?? undefined}>
              <Text color={color}>{label}</Text>
            </Box>
            <Text color={rightColor ?? mutedColor}>{item.right}</Text>
          </Box>
        )
      })}
    </Box>
  )
}

