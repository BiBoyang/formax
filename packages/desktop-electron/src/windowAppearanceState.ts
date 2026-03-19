export type WindowAppearanceState = {
  revision: number
  windowTransparencyEnabled: boolean
}

export function createDefaultWindowAppearanceState(): WindowAppearanceState {
  return {
    revision: 0,
    windowTransparencyEnabled: true,
  }
}
