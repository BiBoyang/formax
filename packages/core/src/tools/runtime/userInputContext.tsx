import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { UserInputManager } from './userInputManager'

const UserInputCtx = createContext<UserInputManager | null>(null)
const UserInputVersionCtx = createContext<number>(0)

export function UserInputProvider({
  userInput,
  children,
}: {
  userInput: UserInputManager
  children: React.ReactNode
}): React.ReactNode {
  const [version, setVersion] = useState(0)

  const wrapped = useMemo<UserInputManager>(() => {
    const bump = () => setVersion((v) => v + 1)
    const isActivePending = (toolUseId: string): boolean => {
      const pendingIds = userInput.getPendingToolUseIds?.()
      if (!pendingIds) return userInput.isPending(toolUseId)
      return pendingIds[0] === toolUseId && userInput.isPending(toolUseId)
    }

    return {
      requestAnswers: (args) => {
        const p = userInput.requestAnswers(args)
        bump()
        return p
      },
      submitAnswers: (toolUseId, answers) => {
        const ok = userInput.submitAnswers(toolUseId, answers)
        bump()
        return ok
      },
      reject: (toolUseId, error) => {
        const ok = userInput.reject(toolUseId, error)
        if (ok) bump()
        return ok
      },
      rejectAllPending: (error) => {
        const n = userInput.rejectAllPending(error)
        if (n > 0) bump()
        return n
      },
      isPending: isActivePending,
      clearBufferedAnswers: () => userInput.clearBufferedAnswers(),
      ...(userInput.getPendingToolUseIds ? { getPendingToolUseIds: userInput.getPendingToolUseIds } : {}),
      ...(userInput.getActivePrompt ? { getActivePrompt: userInput.getActivePrompt } : {}),
      ...(userInput.subscribe ? { subscribe: userInput.subscribe } : {}),
    }
  }, [userInput])

  useEffect(() => {
    if (!userInput.subscribe) return undefined
    return userInput.subscribe(() => setVersion((v) => v + 1))
  }, [userInput])

  return (
    <UserInputCtx.Provider value={wrapped}>
      <UserInputVersionCtx.Provider value={version}>{children}</UserInputVersionCtx.Provider>
    </UserInputCtx.Provider>
  )
}

export function useUserInputManager(): UserInputManager | null {
  // Subscribe to version changes so callers re-render when pending state changes
  // (e.g. after submitting an approval decision, hide the ConfirmMenu promptly).
  void useContext(UserInputVersionCtx)
  return useContext(UserInputCtx)
}
