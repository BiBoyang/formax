import { getGlobalConfig, saveGlobalConfig, type GlobalConfig, type ModelProfile, type ModelPointers } from './config'

export type ModelPointerType = keyof ModelPointers

/**
 * Simplified ModelManager adapted from Kode:
 * - Resolve active model profiles via pointers (main/task/reasoning/quick)
 * - Provide fallbacks to first active profile
 * - Persist pointer changes back to config
 */
export class ModelManager {
  private config: GlobalConfig
  private modelProfiles: ModelProfile[]
  private modelPointers: ModelPointers

  constructor(cfg: GlobalConfig = getGlobalConfig()) {
    this.config = cfg
    this.modelProfiles = cfg.modelProfiles ?? []
    this.modelPointers = cfg.modelPointers ?? { main: '', task: '', reasoning: '', quick: '' }
  }

  getModel(pointer: ModelPointerType = 'main'): ModelProfile | null {
    const id = this.modelPointers[pointer]
    if (id) {
      const p = this.findByModelName(id)
      if (p && p.isActive) return p
      const byName = this.findByName(id)
      if (byName && byName.isActive) return byName
    }
    return this.getDefaultModel()
  }

  getModelName(pointer: ModelPointerType = 'main'): string | null {
    const p = this.getModel(pointer)
    return p ? p.modelName : null
  }

  getMainAgentModel(): string | null {
    return this.getModelName('main')
  }

  getTaskToolModel(): string | null {
    return this.getModelName('task') || this.getModelName('main')
  }

  getActiveModelProfiles(): ModelProfile[] {
    return this.modelProfiles.filter(p => p.isActive)
  }

  hasConfiguredModels(): boolean {
    return this.getActiveModelProfiles().length > 0
  }

  setPointer(pointer: ModelPointerType, modelName: string): void {
    if (!this.findByModelName(modelName) && !this.findByName(modelName)) {
      throw new Error(`Model '${modelName}' not found`)
    }
    this.modelPointers = { ...this.modelPointers, [pointer]: modelName }
    this.persist()
  }

  resolveModel(modelParam: string | ModelPointerType): ModelProfile | null {
    if (this.isPointer(modelParam)) {
      return this.getModel(modelParam)
    }
    const byModelName = this.findByModelName(modelParam)
    if (byModelName && byModelName.isActive) return byModelName
    const byName = this.findByName(modelParam)
    if (byName && byName.isActive) return byName
    return this.getDefaultModel()
  }

  private isPointer(value: string | ModelPointerType): value is ModelPointerType {
    return value === 'main' || value === 'task' || value === 'reasoning' || value === 'quick'
  }

  private findByModelName(modelName: string): ModelProfile | null {
    return this.modelProfiles.find(p => p.modelName === modelName) ?? null
  }

  private findByName(name: string): ModelProfile | null {
    return this.modelProfiles.find(p => p.name === name) ?? null
  }

  private getDefaultModel(): ModelProfile | null {
    const active = this.modelProfiles.find(p => p.isActive)
    return active ?? this.modelProfiles[0] ?? null
  }

  private persist() {
    saveGlobalConfig({
      ...this.config,
      modelProfiles: this.modelProfiles,
      modelPointers: this.modelPointers,
    })
  }
}

let globalModelManager: ModelManager | null = null

export const getModelManager = (): ModelManager => {
  if (!globalModelManager) {
    globalModelManager = new ModelManager()
  }
  return globalModelManager
}

export const reloadModelManager = (): void => {
  globalModelManager = null
}
