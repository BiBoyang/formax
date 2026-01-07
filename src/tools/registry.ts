import type { ToolHandler } from './executor'
import type { ToolDefinition } from './types'
import type { ToolPresenter } from './presenters/types'
import type { ToolSpecSource } from './catalog/proxyJson'

export type ToolSpecPatch = (tools: ToolDefinition[]) => ToolDefinition[]

export type ToolModule = {
  name: string
  aliases?: string[]
  handler?: ToolHandler
  presenter?: ToolPresenter
  specOverride?: ToolDefinition | ((base?: ToolDefinition) => ToolDefinition)
}

export class ToolRegistry {
  private handlers: ToolHandler[] = []
  private presenters = new Map<string, ToolPresenter>()
  private aliases = new Map<string, string>()
  private specOverrides = new Map<string, ToolModule['specOverride']>()
  private patches: ToolSpecPatch[] = []

  constructor(private specSource: ToolSpecSource) {}

  register(module: ToolModule): void {
    if (module.handler) this.handlers.push(module.handler)
    if (module.presenter) this.presenters.set(module.name, module.presenter)
    if (module.specOverride) this.specOverrides.set(module.name, module.specOverride)
    for (const alias of module.aliases ?? []) this.aliases.set(alias, module.name)
  }

  addPatch(fn: ToolSpecPatch): void {
    this.patches.push(fn)
  }

  resolveName(name: string): string {
    return this.aliases.get(name) ?? name
  }

  getPresenter(name: string): ToolPresenter | undefined {
    return this.presenters.get(this.resolveName(name))
  }

  getHandlers(): ToolHandler[] {
    return [...this.handlers]
  }

  async listSpecs(): Promise<ToolDefinition[]> {
    const base = await this.specSource.listSpecs()
    const merged = new Map(base.map((s) => [s.name, s] as const))

    for (const [name, override] of this.specOverrides) {
      const prev = merged.get(name)
      const next = typeof override === 'function' ? override(prev) : override
      merged.set(name, next)
    }

    let specs = Array.from(merged.values())
    for (const patch of this.patches) specs = patch(specs)
    return specs
  }
}

