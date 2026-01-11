export type FileMode = number

export type WriteTextOptions = {
  mode?: FileMode
}

export type WriteJsonOptions = WriteTextOptions & {
  pretty?: boolean
  trailingNewline?: boolean
}

export interface FileStore {
  exists(filePath: string): Promise<boolean>
  readText(filePath: string): Promise<string>
  writeTextAtomic(filePath: string, content: string, options?: WriteTextOptions): Promise<void>
  writeJsonAtomic(filePath: string, value: unknown, options?: WriteJsonOptions): Promise<void>
}

