export type ConfigTab = 'status' | 'config' | 'usage'
export type ConfigRowKind = 'toggle' | 'select'

export type ConfigState = {
  values: Record<string, unknown>
}

export type ConfigRow = {
  id: string
  tab: ConfigTab
  label: string
  kind: ConfigRowKind
  getValue: (state: ConfigState) => string | boolean
}

export const TABS: ConfigTab[] = ['status', 'config', 'usage']

export type ThemeOption = {
  id: string
  label: string
}

export const THEME_OPTIONS: ThemeOption[] = [
  { id: 'dark', label: 'Dark mode' },
  { id: 'light', label: 'Light mode' },
  { id: 'dark_colorblind', label: 'Dark mode (colorblind-friendly)' },
  { id: 'light_colorblind', label: 'Light mode (colorblind-friendly)' },
  { id: 'dark_ansi', label: 'Dark mode (ANSI colors only)' },
  { id: 'light_ansi', label: 'Light mode (ANSI colors only)' },
]

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
    autoCompact: true,
    showTips: true,
    thinkingMode: true,
    rewindCode: true,
    verboseOutput: false,
    terminalProgressBar: true,
    defaultPermissionMode: 'dont_ask',
    respectGitignore: true,
    theme: 'dark',
    notifications: 'auto',
    outputStyle: 'default',
    editorMode: 'normal',
    model: 'default',
    autoInstallIde: true,
  },
}

export const CONFIG_ROWS: ConfigRow[] = [
  {
    id: 'autoCompact',
    tab: 'config',
    label: 'Auto-compact',
    kind: 'toggle',
    getValue: (s) => (s.values.autoCompact as boolean) ?? true,
  },
  {
    id: 'showTips',
    tab: 'config',
    label: 'Show tips',
    kind: 'toggle',
    getValue: (s) => (s.values.showTips as boolean) ?? true,
  },
  {
    id: 'thinkingMode',
    tab: 'config',
    label: 'Thinking mode',
    kind: 'toggle',
    getValue: (s) => (s.values.thinkingMode as boolean) ?? true,
  },
  {
    id: 'rewindCode',
    tab: 'config',
    label: 'Rewind code (checkpoints)',
    kind: 'toggle',
    getValue: (s) => (s.values.rewindCode as boolean) ?? true,
  },
  {
    id: 'verboseOutput',
    tab: 'config',
    label: 'Verbose output',
    kind: 'toggle',
    getValue: (s) => (s.values.verboseOutput as boolean) ?? false,
  },
  {
    id: 'terminalProgressBar',
    tab: 'config',
    label: 'Terminal progress bar',
    kind: 'toggle',
    getValue: (s) => (s.values.terminalProgressBar as boolean) ?? true,
  },
  {
    id: 'defaultPermissionMode',
    tab: 'config',
    label: 'Default permission mode',
    kind: 'select',
    getValue: (s) =>
      ((s.values.defaultPermissionMode as string) ?? 'dont_ask') === 'dont_ask'
        ? "Don't Ask"
        : 'Default',
  },
  {
    id: 'respectGitignore',
    tab: 'config',
    label: 'Respect .gitignore in file picker',
    kind: 'toggle',
    getValue: (s) => (s.values.respectGitignore as boolean) ?? true,
  },
  {
    id: 'theme',
    tab: 'config',
    label: 'Theme',
    kind: 'select',
    getValue: (s) => THEME_OPTIONS.find((t) => t.id === s.values.theme)?.label ?? 'Dark mode',
  },
  {
    id: 'notifications',
    tab: 'config',
    label: 'Notifications',
    kind: 'select',
    getValue: (s) => ((s.values.notifications as string) ?? 'auto') === 'auto' ? 'Auto' : 'Off',
  },
  {
    id: 'outputStyle',
    tab: 'config',
    label: 'Output style',
    kind: 'select',
    // Claude Code shows the raw id (e.g. "default") in the list view.
    getValue: (s) => String((s.values.outputStyle as string) ?? 'default'),
  },
  {
    id: 'editorMode',
    tab: 'config',
    label: 'Editor mode',
    kind: 'select',
    getValue: (s) => (s.values.editorMode as string) ?? 'normal',
  },
  {
    id: 'model',
    tab: 'config',
    label: 'Model',
    kind: 'select',
    getValue: () => 'Default (recommended)',
  },
  {
    id: 'autoInstallIde',
    tab: 'config',
    label: 'Auto-install IDE extension',
    kind: 'toggle',
    getValue: (s) => (s.values.autoInstallIde as boolean) ?? true,
  },
]
