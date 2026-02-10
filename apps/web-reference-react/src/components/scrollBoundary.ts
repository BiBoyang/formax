export type WheelBoundaryInput = {
  deltaY: number
  scrollTop: number
  scrollHeight: number
  clientHeight: number
}

export function shouldStopWheelPropagation(input: WheelBoundaryInput): boolean {
  const { deltaY, scrollTop, scrollHeight, clientHeight } = input
  if (!Number.isFinite(deltaY)) return false
  const atTop = scrollTop <= 0
  const atBottom = scrollTop + clientHeight >= scrollHeight - 1
  if (deltaY < 0) return !atTop
  if (deltaY > 0) return !atBottom
  return false
}
