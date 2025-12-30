import React, { useState, useEffect } from 'react'
import { Box, Text, useInput } from 'ink'

export type SelectOption = {
  label: string
  value: string
}

type SelectProps = {
  options: SelectOption[]
  defaultValue?: string
  onChange?: (value: string) => void
  onFocus?: (value: string) => void
}

export function Select({
  options,
  defaultValue,
  onChange,
  onFocus,
}: SelectProps) {
  // 使用 focusedValue 而不是 focusedIndex，参考 Kode-cli 的实现
  const getInitialFocusedValue = () => {
    if (defaultValue && options.find((opt) => opt.value === defaultValue)) {
      return defaultValue
    }
    return options[0]?.value
  }

  const [focusedValue, setFocusedValue] = useState<string | undefined>(
    getInitialFocusedValue(),
  )

  const [selectedValue, setSelectedValue] = useState<string | undefined>(
    defaultValue,
  )

  // 当 focusedValue 变化时，调用 onFocus（参考 Kode-cli 的实现）
  useEffect(() => {
    if (focusedValue) {
      onFocus?.(focusedValue)
    }
  }, [focusedValue, onFocus])

  // 处理键盘输入
  useInput((_input, key) => {
    if (key.downArrow) {
      const currentIndex = options.findIndex(
        (opt) => opt.value === focusedValue,
      )
      const nextIndex = (currentIndex + 1) % options.length
      setFocusedValue(options[nextIndex]?.value)
    }

    if (key.upArrow) {
      const currentIndex = options.findIndex(
        (opt) => opt.value === focusedValue,
      )
      const prevIndex =
        (currentIndex - 1 + options.length) % options.length
      setFocusedValue(options[prevIndex]?.value)
    }

    if (key.return) {
      if (focusedValue) {
        setSelectedValue(focusedValue)
        onChange?.(focusedValue)
      }
    }
  })

  return (
    <Box flexDirection="column">
      {options.map((option) => {
        const isFocused = focusedValue === option.value
        const isSelected = selectedValue === option.value

        return (
          <Box key={option.value} flexDirection="row">
            <Text>
              {isFocused ? (
                <Text color="cyan">{'> '}</Text>
              ) : (
                <Text>{'  '}</Text>
              )}
              <Text
                color={isFocused ? 'cyan' : isSelected ? 'green' : 'white'}
                bold={isFocused}
              >
                {option.label}
              </Text>
              {isSelected && <Text color="green"> ✓</Text>}
            </Text>
          </Box>
        )
      })}
    </Box>
  )
}

