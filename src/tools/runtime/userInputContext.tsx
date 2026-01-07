import React, { createContext, useContext } from 'react'
import type { UserInputManager } from './userInputManager'

const UserInputCtx = createContext<UserInputManager | null>(null)

export function UserInputProvider({
  userInput,
  children,
}: {
  userInput: UserInputManager
  children: React.ReactNode
}): React.ReactNode {
  return <UserInputCtx.Provider value={userInput}>{children}</UserInputCtx.Provider>
}

export function useUserInputManager(): UserInputManager | null {
  return useContext(UserInputCtx)
}

