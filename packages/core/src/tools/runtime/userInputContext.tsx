import React, { createContext, useContext, useMemo, useState } from 'react'
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
      isPending: (toolUseId) => userInput.isPending(toolUseId),
      clearBufferedAnswers: () => userInput.clearBufferedAnswers(),
    }
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
