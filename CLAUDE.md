# CLAUDE.md
This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Essential Commands

```bash
# Install dependencies
bun install

# Run in development mode
bun run dev

# Build for production
bun run build

# Run tests
bun test
# Run tests in watch mode
bun run test:watch

# Type checking
bun run type-check
```

### Running Single Tests

```bash
# Run all tests
bun test

# Run a specific test file
bun test src/utils/toolFormatting.test.ts

# Run tests matching a pattern
bun test --grep "formatToolCallParts"

# Run tests with coverage
bun test --coverage
```

## High-Level Architecture

Formax is a terminal-based AI chat assistant built with React and Ink (React for CLI). The project implements a streaming chat interface with multi-provider support (Anthropic, OpenAI, and compatible services).

### Core System Architecture

```
┌─────────────────────────────────────────────────────┐
│              Presentation Layer                      │
│  ┌────────────────┐      ┌──────────────────────┐  │
│  │  Onboarding    │      │   ChatScreen         │  │
│  │  Components    │      │   (REPL Interface)   │  │
│  └────────────────┘      └──────────────────────┘  │
└─────────────────────────────────────────────────────┘
           │                           │
           ▼                           ▼
┌─────────────────────┐    ┌──────────────────────────┐
│  Config Manager     │    │   Chat Service           │
│  (Model Profiles)   │    │   (Provider Abstraction) │
└─────────────────────┘    └──────────────────────────┘
           │                           │
           └───────────┬───────────────┘
                       ▼
          ┌──────────────────────────────┐
          │    Agent2 System             │
          │  ┌────────┐    ┌───────────┐ │
          │  │  SSE   │    │  Stream   │ │
          │  │ Parser │    │  Client   │ │
          │  └────────┘    └───────────┘ │
          │  ┌────────────────────────┐ │
          │  │   Tool Executor        │ │
          │  └────────────────────────┘ │
          └──────────────────────────────┘
                       │
                       ▼
          ┌──────────────────────────────┐
          │   External APIs              │
          │  (Anthropic, OpenAI, etc.)   │
          └──────────────────────────────┘
```

### Key Components

#### 1. Entry Point (`src/entrypoints/cli.tsx`)
- Main CLI application entry
- Handles onboarding flow if configuration is incomplete
- Delegates to ChatScreen for main chat interface

#### 2. Presentation Layer (`src/screens/`, `src/components/`)
- **ChatScreen**: Main interactive chat interface using Ink
- **Onboarding**: First-time setup wizard for model configuration
- **UI Components**: Reusable terminal UI components (TextInput, Select, etc.)
- **Chat Components**: Message display, formatting, and interaction

#### 3. Service Layer (`src/services/`)
- **chat.ts**: Unified chat service supporting multiple providers
  - Anthropic API integration with fallback compatibility
  - OpenAI-compatible API support
  - Error handling and normalization
- **models.ts**: Model management and capabilities
- **apiVerification.ts**: API connection testing

#### 4. Agent2 System (`src/agent2/`)
**Modular streaming agent architecture** with extensive property-based testing:

- **SSE Parser** (`agent2/sse/streamingParser.ts`):
  - Parses Anthropic-compatible Server-Sent Events
  - Handles text deltas, tool use blocks, and JSON input fragments
  - Error resilient - continues processing after malformed events

- **Stream Client** (`agent2/streaming/StreamClient.ts`):
  - Manages streaming chat loops
  - Handles tool execution and result aggregation
  - Controls multi-turn conversations

- **Tool Executor** (`agent2/tools/ToolExecutor.ts`):
  - Executes local tools (Read, Write, Bash, Glob, Grep, etc.)
  - Sequential execution with order preservation
  - Error handling per tool

#### 5. Configuration System (`src/utils/config.ts`)
- Hierarchical configuration: global (`~/.kode.json`) and project (`./.kode.json`)
- Model profiles with provider, API key, base URL, and model name
- Multi-model support with active profile selection

#### 6. Utilities (`src/utils/`)
- **toolFormatting.ts**: Tool call and result formatting for display
- **model.ts**: Model manager and profile handling
- **theme.ts**: Terminal theme configuration
- **terminal.ts**: Terminal utilities (clear screen, etc.)
- **config.ts**: Configuration management

## Testing Strategy

### Property-Based Testing with Fast-Check
The codebase heavily uses property-based testing (via `fast-check`) to validate system behavior:

- **toolFormatting.test.ts**: Ensures consistent formatting for all tool types
- **streamingParser.test.ts**: Validates SSE parsing, text accumulation, and JSON round-trips
- **StreamClient.test.ts**: Tests streaming loop behavior
- **ToolExecutor.test.ts**: Validates tool execution and order preservation
- **loopControl.test.ts**: Tests loop termination correctness

### Test Organization
- Unit tests: Co-located with source files as `*.test.ts` or `*.test.tsx`
- Test utilities: Mock factories and helpers in test files
- Property tests cover edge cases and random inputs (typically 50-100 runs per property)

## Important Implementation Details

### Multi-Provider Support
- **Anthropic**: Native SDK with fetch fallback for 401 errors (improves gateway compatibility)
- **OpenAI-compatible**: Standard OpenAI SDK for providers like OpenAI, DeepSeek, etc.
- **Base URL normalization**: Removes duplicate `/v1` paths and trailing slashes

### Streaming vs Non-Streaming
- **Anthropic/Custom-Anthropic**: Uses Agent2 system for tool-enabled streaming
- **Other providers**: Falls back to non-streaming `sendMessage` in `chat.ts`

### Tool System
Tools are executed locally with the following capabilities:
- **File Operations**: Read, Write, Edit (via ToolExecutor)
- **Search**: Glob (pattern matching), Grep (content search)
- **Execution**: Bash (command execution with timeout)
- **Result formatting**: Truncation, line counting, and display optimization

### Configuration Architecture
```
Global Config (~/.kode.json)
├── hasCompletedOnboarding: boolean
├── models: ModelProfile[]
└── activeModelId: string

ModelProfile
├── id: string
├── provider: 'anthropic' | 'custom-anthropic' | 'openai' | 'custom-openai'
├── apiKey: string
├── baseURL?: string
├── modelName: string
└── maxTokens?: number
```

### Error Handling
- API errors are caught and converted to user-friendly messages
- Network errors provide actionable guidance
- Tool errors don't stop execution of subsequent tools
- SSE parser continues after malformed events

## Development Patterns

### Adding a New Tool
1. Implement tool logic in `agent2/tools/ToolExecutor.ts` (runLocalTool function)
2. Add formatting logic in `utils/toolFormatting.ts` (formatToolCallParts, formatToolResult)
3. Add property tests in `agent2/tools/ToolExecutor.test.ts`
4. Register tool in the agent system (when tool registration is implemented)

### Adding a New Model Provider
1. Add provider type to constants
2. Implement API client in `services/chat.ts` or create new adapter
3. Add provider option to onboarding components
4. Update configuration schema

### Adding New UI Components
- Follow existing Ink component patterns
- Use theme from `utils/theme.ts` for consistent styling
- Test with `ink-testing-library` if complex

### Debugging Tips
- Use `NODE_ENV=test` to skip onboarding during testing
- ChatScreen displays current config in header for debugging
- Vitest watch mode: `bun run test:watch`
- Individual test files can be run directly: `bun test path/to/test.test.ts`

## File Type Conventions
- `.tsx`: React/Ink UI components
- `.ts`: Business logic, services, utilities
- `.test.ts`: Unit tests for non-UI code
- `.test.tsx`: Tests for React components using ink-testing-library
