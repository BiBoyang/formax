export type ConfigTab = 'status' | 'config' | 'usage'
export type ConfigRowKind = 'toggle' | 'select'

export type ConfigState = {
  values: Record<string, unknown>
  sources: Record<string, string>
}

export type ConfigRow = {
  id: string
  tab: ConfigTab
  label: string
  kind: ConfigRowKind
  getValue: (state: ConfigState) => string | boolean
}

export const TABS: ConfigTab[] = ['status', 'config', 'usage']

export type OutputStyleOption = {
  id: string
  label: string
  description: string
}

export const OUTPUT_STYLE_OPTIONS: OutputStyleOption[] = [
  {
    id: 'default',
    label: 'Default',
    description: 'Formax completes coding tasks efficiently and provides concise responses',
  },
  {
    id: 'explanatory',
    label: 'Explanatory',
    description: 'Formax explains implementation choices and codebase patterns',
  },
  {
    id: 'learning',
    label: 'Learning',
    description: 'Formax pauses and asks you to write small pieces of code for hands-on practice',
  },
]

export const INITIAL_CONFIG_STATE: ConfigState = {
  values: {
    outputStyle: 'default',
    thinkingMode: true,
    verboseOutput: false,
  },
  sources: {
    outputStyle: 'Default',
    thinkingMode: 'Default',
    verboseOutput: 'Default',
  },
}

export const CONFIG_ROWS: ConfigRow[] = [
  {
    id: 'thinkingMode',
    tab: 'config',
    label: 'Thinking mode',
    kind: 'toggle',
    getValue: (s) => (s.values.thinkingMode as boolean) ?? true,
  },
  {
    id: 'verboseOutput',
    tab: 'config',
    label: 'Verbose output',
    kind: 'toggle',
    getValue: (s) => (s.values.verboseOutput as boolean) ?? false,
  },
  {
    id: 'outputStyle',
    tab: 'config',
    label: 'Output style',
    kind: 'select',
    getValue: (s) => {
      const id = String((s.values.outputStyle as string) ?? 'default')
      return OUTPUT_STYLE_OPTIONS.find((o) => o.id === id)?.label ?? 'Default'
    },
  },
]
