export type SidebarTransparencyMode = 'css' | 'native'

export type WindowAppearanceState = {
  revision: number
  sidebarTransparencyEnabled: boolean
  sidebarTransparencyMode: SidebarTransparencyMode
}

export function createDefaultWindowAppearanceState(): WindowAppearanceState {
  return {
    revision: 0,
    sidebarTransparencyEnabled: false,
    sidebarTransparencyMode: 'css',
  }
}
