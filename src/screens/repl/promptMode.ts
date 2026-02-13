import type { ToolRegistry } from '../../tools/registry'
import type { UserInputManager } from '../../tools/runtime/userInputManager'
import type { ReplControllerState } from '../../features/repl/useReplController'
import { isAlwaysInteractiveToolName } from '../../features/tools/presentation/toolSemantics'

export function isPromptMode(args: {
  state: ReplControllerState
  userInput: UserInputManager | null
  toolRegistry?: ToolRegistry
}): boolean {
  const { state, userInput, toolRegistry } = args

  if (state.agentsDialogOpen) return true
  if (state.permissionsDialogOpen) return true
  if (state.hooksDialogOpen) return true
  if (state.configDialogOpen) return true
  if (state.resumeDialogOpen) return true
  if (!userInput) return false

  return state.transientMessages.some((m) => {
    if (m.role !== 'tool' || m.toolInfo?.status !== 'running') return false
    const toolUseId = m.toolInfo.toolUseId || (m.id.startsWith('tool-') ? m.id.slice('tool-'.length) : m.id)
    const interactive =
      toolRegistry?.getMeta(m.toolInfo.name)?.interactive ?? isAlwaysInteractiveToolName(m.toolInfo.name)
    if (m.toolInfo.name === 'Task' && Array.isArray(m.toolInfo.nestedTools)) {
      return m.toolInfo.nestedTools.some((t) => Boolean(t?.id) && userInput.isPending(String(t.id)))
    }
    return interactive || userInput.isPending(toolUseId)
  })
}
