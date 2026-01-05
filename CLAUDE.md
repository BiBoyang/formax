# CLAUDE.md
This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Formax is a terminal-based CLI chat application built with React + Ink that provides an interface for interacting with AI models (Anthropic, OpenAI, and compatible APIs). The app features a multi-step onboarding wizard for model configuration and a chat interface for conversations.

## Key Commands

### Development
```bash
bun run dev          # Run the main CLI application
bun run type-check   # TypeScript type checking
```

### Testing
```bash
bun run test         # Run all tests once
bun run test:watch   # Run tests in watch mode
```

**Run a single test:**
```bash
# Run a specific test file
bunx vitest run src/utils/toolFormatting.test.ts

# Run with filter pattern
bunx vitest run -t "test name pattern"

# Run tests in watch mode with filter
bunx vitest -t "test name pattern"
```

## Architecture

### Entry Points
- `src/entrypoints/cli.tsx` - Main entry point, renders MyChatScreen
- `src/entrypoints/tool-examples.tsx` - Alternative entry for tool examples

### Core Components

**Screens:**
- `src/screens/MyChatScreen.tsx` - Main chat interface
- `src/screens/ToolExamplesScreen.tsx` - Tool usage examples

**Components:**
- `src/components/ui/` - UI primitives (TextInput, Select)
- `src/components/tool/` - Tool-related components
- `src/components/display/` - Display/demonstration components

**Agent/Streaming:**
- `src/agent2/sse/` - Server-Sent Events parsing
- `src/agent2/streaming/` - Streaming response handling
- `src/agent2/tools/` - Tool execution logic

### State Management

- **Jotai** - Primary state management (atomic state)
- `src/store/configAtoms.ts` - Configuration-related atoms

### Utilities

- `src/utils/config.ts` - Global config file management (~/.formax/config.json)
- `src/utils/toolFormatting.ts` - Tool response formatting
- `src/utils/theme.ts` - Terminal theme definitions (dark/light/daltonized)
- `src/utils/terminal.ts` - Terminal utilities (clear screen)

### Configuration File

Located at `~/.formax/config.json`:
```json
{
  "theme": "dark",
  "hasCompletedOnboarding": false,
  "model": {
    "provider": "anthropic",
    "baseURL": "https://...",
    "apiKey": "sk-...",
    "name": "claude-3-5-sonnet",
    "maxTokens": 8192,
    "contextLength": 128000
  }
}
```

## Technology Stack

- **TypeScript** - Type safety (strict mode disabled)
- **React 18** - UI framework
- **Ink 5** - Terminal UI rendering (React for CLI)
- **Jotai** - State management
- **Vitest** - Testing framework
- **tsx** - TypeScript execution (no build step for dev)
- **Bun** - Package manager/runtime (npm compatible)

## Key Patterns

### Ink Component Structure
```tsx
import { render } from 'ink'

render(<Component />, { exitOnCtrlC: false })
```

### Testing Ink Components
Uses `ink-testing-library` for rendering components in tests:
```tsx
import { render } from 'ink-testing-library'
const { lastFrame } = render(<Component />)
```

### State with Jotai
```tsx
import { atom, useAtom } from 'jotai'
const myAtom = atom(initialValue)
const [value, setValue] = useAtom(myAtom)
```

## Documentation

Detailed architecture documentation is available in `docs/`:
- `ARCHITECTURE.md` - Startup flow and onboarding
- `ARCHITECTURE-PART2.md` through `ARCHITECTURE-PART5.md` - Detailed component architecture
- `QUICK-START-GUIDE.md` - 5-minute quick start guide
