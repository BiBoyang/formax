export type PreviewRow = { key: string; text: string; dim?: boolean }

export type ResumeListView<T> = {
  top: number
  visible: T[]
  hasMoreAbove: boolean
  hasMoreBelow: boolean
  total: number
}

