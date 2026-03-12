import type { Msg } from './types'
import { isNonEmptyRecord } from './validation'

function mergeLegacyToolFieldsIntoPersisted(args: { persisted: Msg; legacy: Msg }): Msg {
  if (args.persisted.role !== 'tool' || args.legacy.role !== 'tool') return args.persisted
  const persistedToolInfo = args.persisted.toolInfo
  const legacyToolInfo = args.legacy.toolInfo
  if (!persistedToolInfo || !legacyToolInfo) return args.persisted

  const mergedInput =
    isNonEmptyRecord(persistedToolInfo.input) || !isNonEmptyRecord(legacyToolInfo.input)
      ? persistedToolInfo.input
      : legacyToolInfo.input
  const mergedResult =
    typeof persistedToolInfo.result === 'string' && persistedToolInfo.result.trim().length > 0
      ? persistedToolInfo.result
      : legacyToolInfo.result
  const mergedMiddleLines =
    Array.isArray(persistedToolInfo.middleLines) && persistedToolInfo.middleLines.length > 0
      ? persistedToolInfo.middleLines
      : legacyToolInfo.middleLines
  const mergedPatchStartLineNumber =
    typeof persistedToolInfo.patchStartLineNumber === 'number' &&
    Number.isFinite(persistedToolInfo.patchStartLineNumber) &&
    persistedToolInfo.patchStartLineNumber > 0
      ? Math.floor(persistedToolInfo.patchStartLineNumber)
      : typeof legacyToolInfo.patchStartLineNumber === 'number' &&
          Number.isFinite(legacyToolInfo.patchStartLineNumber) &&
          legacyToolInfo.patchStartLineNumber > 0
        ? Math.floor(legacyToolInfo.patchStartLineNumber)
        : undefined

  const mergedToolInfo = {
    ...persistedToolInfo,
    ...(mergedInput !== undefined ? { input: mergedInput } : {}),
    ...(mergedResult !== undefined ? { result: mergedResult } : {}),
    ...(mergedMiddleLines !== undefined ? { middleLines: mergedMiddleLines } : {}),
    ...(mergedPatchStartLineNumber !== undefined ? { patchStartLineNumber: mergedPatchStartLineNumber } : {}),
  }

  const mergedContent =
    (typeof args.persisted.content === 'string' && args.persisted.content.trim().length > 0
      ? args.persisted.content
      : args.legacy.content) ?? args.persisted.content

  return {
    ...args.persisted,
    ...(typeof mergedContent === 'string' ? { content: mergedContent } : {}),
    toolInfo: mergedToolInfo,
  }
}

export {
  mergeLegacyToolFieldsIntoPersisted,
}

