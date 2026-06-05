import type { ToolHandler } from './executor'
import type { ToolDefinition } from './types'
import type { ToolPresenter } from '../shared/toolPresenterContracts'

export type ToolSpecPatch = (tools: ToolDefinition[]) => ToolDefinition[]

export type ToolSpec = ToolDefinition | ((base?: ToolDefinition) => ToolDefinition)

export type ToolMeta = {
  /**
   * Whether this tool takes over the UI and should hide the main input bar as
   * soon as it starts running (even before a user-input promise is pending).
   */
  interactive?: boolean
}

export type ToolModule = {
  name: string
  aliases?: string[]
  handler?: ToolHandler
  presenter?: ToolPresenter
  canPresent?: (name: string) => boolean
  spec?: ToolSpec
  patch?: ToolSpecPatch
  meta?: ToolMeta
}

export class ToolRegistry {
  private handlers: ToolHandler[] = []
  private presenters = new Map<string, ToolPresenter>()
  private presenterMatchers: Array<{ canPresent: (name: string) => boolean; presenter: ToolPresenter }> = []
  private aliases = new Map<string, string>()
  private specs = new Map<string, ToolSpec>()
  private meta = new Map<string, ToolMeta>()
  private patches: ToolSpecPatch[] = []

  register(module: ToolModule): void {
    if (module.handler) this.handlers.push(module.handler)
    if (module.presenter) this.presenters.set(module.name, module.presenter)
    if (module.presenter && module.canPresent) {
      this.presenterMatchers.push({ canPresent: module.canPresent, presenter: module.presenter })
    }
    if (module.spec) this.specs.set(module.name, module.spec)
    if (module.patch) this.addPatch(module.patch)
    if (module.meta) this.meta.set(module.name, module.meta)
    for (const alias of module.aliases ?? []) this.aliases.set(alias, module.name)
  }

  addPatch(fn: ToolSpecPatch): void {
    this.patches.push(fn)
  }

  resolveName(name: string): string {
    return this.aliases.get(name) ?? name
  }

  getPresenter(name: string): ToolPresenter | undefined {
    const resolvedName = this.resolveName(name)
    return this.presenters.get(resolvedName)
      ?? this.presenterMatchers.find((entry) => entry.canPresent(resolvedName))?.presenter
  }

  getMeta(name: string): ToolMeta | undefined {
    return this.meta.get(this.resolveName(name))
  }

  getHandlers(): ToolHandler[] {
    return [...this.handlers]
  }

  async listSpecs(): Promise<ToolDefinition[]> {
    const merged = new Map<string, ToolDefinition>()
    for (const [name, spec] of this.specs) {
      const prev = merged.get(name)
      const next = typeof spec === 'function' ? spec(prev) : spec
      merged.set(name, next)
    }

    let specs = Array.from(merged.values())
    for (const patch of this.patches) specs = patch(specs)
    return specs
  }
}
