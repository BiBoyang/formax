# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Formax is a CLI tool built with React and Ink for terminal UI. It provides an interactive onboarding wizard for configuring AI model providers and a chat interface for interacting with them.

**Technology Stack:**
- TypeScript + React 18
- Ink (terminal UI framework)
- Jotai + jotai-immer (state management)
- @inkjs/ui (UI components)
- Anthropic SDK and OpenAI SDK (AI provider clients)
- tsx (TypeScript executor)

## Common Commands

```bash
# Development (runs CLI with tsx)
npm run dev
bun run dev

# Type checking
npm run type-check

# Build (produces dist/cli.js)
npm run build
bun build
```

## Architecture

### Entry Point Flow

`src/entrypoints/cli.tsx` is the main entry. On startup:

1. Reads global config from `~/.formax/config.json` (via `getGlobalConfig()`)
2. If `hasCompletedOnboarding` is false, renders `<Onboarding>` wizard
3. If onboarding complete and model is configured, renders `<ChatScreen>`
4. Otherwise shows welcome message

### Configuration System

**Config location:** `~/.formax/config.json` (defined by `FORMAX_CONFIG_FILE` in `src/utils/env.ts`)

**Config type:** `GlobalConfig` in `src/utils/config.ts`
```typescript
type GlobalConfig = {
  theme: ThemeName                    // 'dark' | 'light' | 'dark-daltonized' | 'light-daltonized'
  hasCompletedOnboarding?: boolean
  model?: {
    provider?: string                 // Provider key (e.g., 'anthropic', 'openai', 'ollama')
    baseURL?: string                  // Custom API endpoint
    apiKey?: string
    name?: string                     // Model name
    maxTokens?: number
    contextLength?: number
    reasoningEffort?: 'low' | 'medium' | 'high'
  }
}
```

**Key functions:**
- `getGlobalConfig()` - Reads config, merges with defaults
- `saveGlobalConfig(config)` - Saves config (deep merges model object)

### State Management (Jotai)

Located in `src/store/configAtoms.ts`:
- `configAtom` - Main app state using `atomWithImmer` for immutable updates
- `themeAtom` - Derived read/write atom for theme
- `hasCompletedOnboardingAtom` - Derived atom for onboarding status

When updating complex objects in config atoms:
```typescript
set(configAtom, (draft) => {
  draft.model?.apiKey = newKey
  draft.hasCompletedOnboarding = true
})
```

### Onboarding Wizard

The onboarding is a multi-step wizard in `src/components/onboarding/Onboarding.tsx`:

**Main steps:**
1. `ThemeStep` - Theme selection with live code preview
2. `UsageStep` - Usage instructions (Press Enter to continue)
3. `ModelStep` - Entry point to ModelSelector wizard

**ModelSelector sub-steps** (12 steps in `src/components/onboarding/ModelSelector.tsx`):
- ProviderSelection - Choose AI provider (Anthropic, OpenAI, Ollama, custom, etc.)
- BaseUrl - Custom API endpoint (for custom/Ollama providers)
- ApiKey - Input API key, validates and fetches available models
- ModelSelection - Select from fetched models OR ModelInput (manual entry)
- ModelParams - Configure max tokens
- ContextLength - Set context window size
- ConnectionTest - Verify API connection works
- Confirmation - Review and save config

**Provider keys** are defined in `src/constants/providers.ts`. Custom providers like `custom-openai`, `custom-anthropic`, and `ollama` require baseURL configuration.

### AI Provider Integration

`src/services/chat.ts` handles all AI communication:

- Anthropic providers use `@anthropic-ai/sdk`
- OpenAI-compatible providers use `openai` package
- Provider is selected from `config.model.provider`
- Custom baseURL is supported via `config.model.baseURL`

### Component Structure

```
src/
├── components/
│   ├── chat/           # Chat interface components
│   ├── display/        # Component showcase / re-exports
│   ├── onboarding/     # Wizard step components
│   └── ui/             # Reusable UI components (Select, TextInput, etc.)
├── constants/          # Providers, models
├── entrypoints/        # CLI entry point
├── screens/            # Full-screen views (ChatScreen)
├── services/           # API clients, verification
├── store/              # Jotai atoms
└── utils/              # Config, terminal, theme utilities
```

## Key Patterns

### Ink Components
- Functional components with hooks
- `useInput()` hook for keyboard input handling
- `render()` from Ink to mount components
- Exit on Ctrl+C with `exitOnCtrlC: true` in render options

### Theme Support
Themes are defined in `src/utils/theme.ts`. Four themes available for different accessibility needs (dark/light, with/without daltonization).

### File Imports
All imports use `.js` extension due to ESNext module resolution (required by tsconfig bundler mode).

## Cursor Rules Integration

The `.cursor/rules/` directory contains architecture rules for a larger monorepo project (apps/web, apps/api, apps/desktop, packages/types). Formax is currently a standalone CLI project and does not follow the monorepo structure described in those rules.

Key differences:
- Formax is a single-package CLI tool (not a monorepo)
- Uses Ink for terminal UI (not React web + Vite)
- Config stored in `~/.formax/config.json` (not database/backend)
- No Electron, no Express backend, no Drizzle ORM
- Direct AI SDK integration (no backend proxy)

Focus on the patterns within `src/` rather than the Cursor monorepo rules.
