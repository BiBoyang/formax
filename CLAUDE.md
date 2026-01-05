# CLAUDE.md
This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Formax** is a terminal-based CLI chat tool built with React and Ink that provides an interactive AI assistant experience. It features a comprehensive onboarding wizard for configuring AI model providers (Anthropic, OpenAI, Ollama, custom APIs) and a chat interface with agent loop capabilities.

## Build/Lint/Test Commands

```bash
# Development
bun run dev        # Run main CLI (src/entrypoints/cli.tsx)
bun run dev2       # Run alternative CLI (src/entrypoints/my-cli.tsx)

# Build
bun run build      # Build to dist/cli.js (Node.js target)

# Type checking
bun run type-check # TypeScript type checking (tsc --noEmit)
```

**Package Manager:** Bun (also supports npm/pnpm)
**Node Version:** >=18.0.0

### No Tests Currently
There are no test files or test commands configured yet. The project uses `NODE_ENV === 'test'` checks in some files (e.g., `config.ts`, `cli.tsx`) but no actual test suite exists.

## High-Level Architecture

### Tech Stack
- **Runtime:** TypeScript + TSX (no build step in dev)
- **UI Framework:** React 18.3.1 + Ink 5.2.1 (React for terminal)
- **UI Components:** @inkjs/ui 2.0.0
- **State Management:** Jotai 2.16.1 + jotai-immer 0.4.1
- **AI SDKs:** @anthropic-ai/sdk 0.71.2, openai 6.15.0
- **Styling:** Chalk 5.4.1 (terminal colors)

### Entry Points
- **`src/entrypoints/cli.tsx`** - Main CLI entry point
  - Checks for onboarding completion (`~/.formax/config.json`)
  - Shows `Onboarding` component if not completed
  - Shows `ChatScreen` if setup complete
  - Handles stdin for pipe/redirect inputs (currently commented out)

### Directory Structure

```
src/
├── entrypoints/           # CLI entry points
│   ├── cli.tsx           # Main entry (bun run dev)
│   └── my-cli.tsx        # Alternative entry (bun run dev2)
│
├── screens/              # Full-screen views
│   ├── ChatScreen.tsx    # Chat interface with message history
│   └── MyChatScreen.tsx  # Alternative chat implementation
│
├── components/
│   ├── onboarding/       # Multi-step onboarding wizard
│   │   ├── Onboarding.tsx           # Main wizard orchestrator
│   │   ├── ThemeStep.tsx            # Step 1: Theme selection
│   │   ├── UsageStep.tsx            # Step 2: Usage instructions  
│   │   ├── ModelStep.tsx            # Step 3: Model config entry
│   │   ├── ModelSelector.tsx        # Step 4: Model setup wizard (12 substeps)
│   │   ├── useModelSetupWizard.ts   # State machine for model setup
│   │   └── steps/                   # Individual model setup steps
│   │       ├── ProviderSelectionStep.tsx
│   │       ├── BaseUrlStep.tsx
│   │       ├── ApiKeyStep.tsx
│   │       ├── ModelSelectionStep.tsx
│   │       ├── ModelInputStep.tsx
│   │       ├── ModelParamsStep.tsx
│   │       ├── ContextLengthStep.tsx
│   │       ├── ConnectionTestStep.tsx
│   │       └── ConfirmationStep.tsx
│   │
│   ├── chat/             # Chat-related components
│   │   └── ChatMessage.tsx
│   │
│   ├── ui/               # Reusable UI components
│   │   ├── TextInput.tsx
│   │   ├── Select.tsx
│   │   ├── CodePreview.tsx
│   │   └── PressEnterToContinue.tsx
│   │
│   └── display/          # Display utilities
│       ├── ink.tsx
│       └── inkjs-ui.tsx
│
├── agent/                # AI agent runtime
│   ├── runtime/
│   │   ├── AgentLoop.ts     # Main agent loop with tool execution
│   │   └── LLMClient.ts     # Universal LLM client (Anthropic format)
│   ├── sse/
│   │   └── parseAnthropicSSE.ts
│   └── types.ts             # Agent types (LLMMessage, ToolCall, etc.)
│
├── services/             # Business logic layer
│   ├── chat.ts          # Chat service (non-streaming fallback)
│   ├── models.ts        # Model fetching/verification for providers
│   └── apiVerification.ts
│
├── store/               # Global state atoms
│   └── configAtoms.ts   # Jotai atoms for config
│
├── utils/               # Shared utilities
│   ├── config.ts        # Config file management (~/.formax/config.json)
│   ├── env.ts           # Environment variables
│   ├── model.ts         # Model manager for active profiles
│   ├── theme.ts         # Theme system (4 themes: dark, light, daltonized variants)
│   ├── terminal.ts      # Terminal utilities (clear screen, etc.)
│   └── ...
│
└── constants/           # Static data
    ├── providers.ts     # Provider definitions
    └── models.ts        # Model definitions
```

### Configuration System

**Config File:** `~/.formax/config.json`

**Structure:**
```typescript
{
  theme: 'dark' | 'light' | 'dark-daltonized' | 'light-daltonized',
  hasCompletedOnboarding: boolean,
  modelProfiles: ModelProfile[],  // Multiple model configurations
  modelPointers: {                 // Which model to use for what
    main: string,
    task: string,
    reasoning: string,
    quick: string
  },
  defaultModelName: string,
  model?: ModelConfig  // Legacy format (auto-migrated)
}
```

**Key Functions:**
- `getGlobalConfig()` - Read config (with defaults merge)
- `saveGlobalConfig(config)` - Save config (filters defaults, deep merge)
- `getActiveModelProfile(config)` - Get current active model
- Legacy `model` object auto-migrates to `modelProfiles` array

**Note:** Config uses Kode-compatible model profile format for multi-model support.

### Agent System

**Core Flow:**
1. `ChatScreen` uses `AgentLoop.runAgentLoop()` for Anthropic providers
2. Loop streams LLM responses, detects tool calls, executes tools, adds tool results
3. Continues until no more tool calls (currently tools not implemented)
4. Falls back to `services/chat.ts` for non-Anthropic providers

**Key Files:**
- `agent/runtime/AgentLoop.ts` - Orchestrates LLM streaming + tool execution loop
- `agent/runtime/LLMClient.ts` - Unified client for Anthropic-format streaming
- `agent/types.ts` - Universal types (LLMMessage, ToolCall, ContentBlock, etc.)

**Tool System:** Infrastructure ready but no tools registered yet. `execTool` currently returns error stub.

### Onboarding Wizard

**Flow:**
1. **ThemeStep** - Choose terminal theme (live preview)
2. **UsageStep** - Show usage instructions
3. **ModelStep** - Entry to model setup
4. **ModelSelector** - 12-step wizard:
   - ProviderSelection → BaseUrl (if custom/Ollama) → ApiKey
   - Auto-fetch models OR manual ModelInput
   - ModelSelection → ModelParams → ContextLength
   - ConnectionTest → Confirmation

**State Management:** `useModelSetupWizard` hook manages wizard state machine

**Provider Support:**
- Anthropic, OpenAI, Azure OpenAI, Google AI, OpenRouter
- Custom OpenAI-compatible, Custom Anthropic-compatible
- Ollama (local models)
- Partner providers (DeepSeek, xAI, etc.)

### Services Layer

**`services/models.ts`** - Model fetching/verification:
- `fetchAnthropicModels()`, `fetchOpenAIModels()`, etc.
- `verifyApiKey()` - Universal API verification
- Handles all provider-specific API quirks

**`services/chat.ts`** - Chat service (non-streaming):
- Used for non-Anthropic providers
- Falls back when AgentLoop not applicable

**`services/apiVerification.ts`** - API key verification helpers

### Theme System

4 themes available (see `utils/theme.ts`):
- `dark` - Light text on dark background
- `light` - Dark text on light background  
- `dark-daltonized` - Colorblind-friendly dark
- `light-daltonized` - Colorblind-friendly light

Theme affects all UI components via `getTheme()` helper.

## Key Design Patterns

### 1. Feature-First Organization
Code organized by feature/screen rather than technical layers. Related components, hooks, and logic stay together.

### 2. Jotai for State
Uses atomic state management. Config atoms in `store/configAtoms.ts`. Each component can subscribe to specific atoms.

### 3. Ink Rendering
React components render to terminal using Ink's `<Box>`, `<Text>`, `<Static>` primitives. No DOM, just ANSI terminal output.

### 4. Type Safety
Strict TypeScript with shared types in `agent/types.ts` for AI interactions.

### 5. Config Persistence
All user settings persist to `~/.formax/config.json`. No database needed.

## Development Notes

### Running the CLI
```bash
bun run dev                    # Normal interactive mode
echo "hello" | bun run dev    # Pipe input (stdin detection commented out)
bun run dev < input.txt       # File redirect
```

### stdin Detection
Currently commented out in `cli.tsx`. Logic checks `process.stdin.isTTY` to detect pipe/redirect vs interactive terminal.

### Hot Reload
TSX provides fast reload. No build step needed during development.

### Debugging
Add `console.error()` calls (stderr doesn't interfere with Ink rendering). Or use `renderContext.stderr` for controlled output.

## Related Documentation

- **`README.md`** - Quick start guide, project structure
- **`docs/ARCHITECTURE.md`** - Detailed architecture walkthrough (Chinese)
- **`docs/QUICK-START-GUIDE.md`** - Step-by-step usage guide
- **`.cursor/rules/`** - Cursor IDE rules (architecture patterns, workflow)
  - `01-architecture.mdx` - Feature-first pattern (references lobe-chat but this is NOT a monorepo)
  - `06-workflow.mdx` - Dev commands and conventions

**Note:** Some `.cursor/rules` files reference a monorepo structure with `apps/web`, `apps/api`, `packages/types` etc. **This is NOT accurate for Formax** - it's a single package CLI tool. Those rules appear to be copied from a different project (lobe-chat reference). Ignore monorepo-related guidance.

## proxy/ Directory

Contains proxy server code for debugging/intercepting AI API calls:
- `proxy/index.js` - HTTP proxy server
- `proxy/traffic-logs/` - Captured request/response logs
- `proxy/tools.json` - Tool definitions for testing

This is development tooling, not part of the main app.

## Common Tasks

### Add a New Provider
1. Add provider definition to `constants/providers.ts`
2. Add model fetching logic to `services/models.ts`
3. Update `ModelSelector` provider list
4. Add provider-specific handling in `LLMClient` if needed

### Add a New Tool
1. Define tool in `agent/types.ts` (ToolDefinition)
2. Implement executor function
3. Register in `ChatScreen` tools array
4. Update `execTool` handler

### Modify Theme
1. Edit `utils/theme.ts` theme definitions
2. Themes automatically apply to all components via `getTheme()`

### Change Config Schema
1. Update `GlobalConfig` type in `utils/config.ts`
2. Update `DEFAULT_GLOBAL_CONFIG` defaults
3. Add migration logic if needed (see `migrateLegacyModelConfig` example)

## Environment Variables

Defined in `utils/env.ts`:
- `FORMAX_CONFIG_DIR` - Override config directory (default: `~/.formax`)
- Other env vars loaded via `dotenv` from `.env` file

## Code Style Notes

- TypeScript strict mode disabled (`strict: false` in tsconfig)
- Module resolution: `bundler` mode (ESNext modules)
- JSX: React (not React JSX)
- Path aliases: None configured (use relative imports)
- No linting/formatting commands defined yet

## Known Limitations

1. **No tests** - Test infrastructure stubbed but not implemented
2. **Tool system incomplete** - Agent loop ready but no tools registered
3. **Streaming only for Anthropic** - Other providers use non-streaming fallback
4. **stdin handling disabled** - Pipe/redirect input detection commented out
5. **No multi-model switching** - `modelPointers` system exists but not used in UI

## Architecture Philosophy

This project takes inspiration from lobe-chat's patterns (mentioned in `.cursor/rules`) but is **fundamentally different**:
- **Formax:** Single-package CLI tool (no monorepo, no web frontend, no backend API)
- **lobe-chat:** Full-stack monorepo with web app, API server, and shared packages

Keep the CLI-first mindset when working with this codebase. Everything runs in a single terminal process with Ink rendering.
