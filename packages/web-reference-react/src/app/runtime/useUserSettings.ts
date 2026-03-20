import { useCallback, useState } from 'react'
import { DEFAULT_USER_SETTINGS, type UpdateUserSetting, type UserSettings } from '../core/userSettings'

export function useUserSettings(): { userSettings: UserSettings; updateUserSetting: UpdateUserSetting } {
  const [userSettings, setUserSettings] = useState<UserSettings>(DEFAULT_USER_SETTINGS)

  const updateUserSetting = useCallback<UpdateUserSetting>((key, value) => {
    setUserSettings((previous) => {
      if (Object.is(previous[key], value)) return previous
      return { ...previous, [key]: value }
    })
  }, [])

  return {
    userSettings,
    updateUserSetting,
  }
}
