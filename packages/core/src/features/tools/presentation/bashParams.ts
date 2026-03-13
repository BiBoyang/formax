import {
  formatToolInputAsParamsText,
  orderToolParamsByToolName,
  parseToolParamsText,
  stringifyToolParams,
} from './paramsText'

export type BashParamsPresentation = {
  hasCommandParam: boolean
  command: string | null
  paramsText: string | undefined
  paramsTextWithoutCommand: string | undefined
}

function buildFromParamsText(paramsText: string | undefined): BashParamsPresentation {
  if (!paramsText) {
    return {
      hasCommandParam: false,
      command: null,
      paramsText: undefined,
      paramsTextWithoutCommand: undefined,
    }
  }

  const ordered = orderToolParamsByToolName('Bash', parseToolParamsText(paramsText))
  const commandEntry = ordered.find((param) => param.label === 'command')
  const command = commandEntry?.value ?? null
  const hasCommandParam = Boolean(commandEntry)
  const normalizedParamsText = stringifyToolParams(ordered, Number.MAX_SAFE_INTEGER) ?? paramsText
  const withoutCommand = ordered.filter((param) => param.label !== 'command')
  const paramsTextWithoutCommand = stringifyToolParams(withoutCommand, Number.MAX_SAFE_INTEGER)

  return {
    hasCommandParam,
    command,
    paramsText: normalizedParamsText,
    paramsTextWithoutCommand,
  }
}

export function buildBashParamsFromParamsText(paramsText: string | undefined): BashParamsPresentation {
  return buildFromParamsText(paramsText)
}

export function buildBashParamsFromInput(input: unknown): BashParamsPresentation {
  const paramsText = formatToolInputAsParamsText(input)
  return buildFromParamsText(paramsText)
}
