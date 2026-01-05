# Requirements Document

## Introduction

This specification defines the requirements for refactoring tool UI components from MyChatScreen.tsx into reusable components and creating a tool-examples debugging page. The goal is to improve code maintainability, reusability, and provide better debugging capabilities for tool UI components.

## Glossary

- **ToolMessage**: A React component that renders a single tool execution message with Claude Code styling
- **ToolExamplesScreen**: A dedicated screen for displaying various tool UI states for debugging purposes
- **MyChatScreen**: The main chat interface that currently contains embedded tool UI rendering logic
- **Msg**: The message type containing tool execution information (name, input, status, result, etc.)
- **formatToolCallParts**: Function that formats tool name and parameters for display
- **formatToolResult**: Function that formats tool execution results with proper line handling
- **Claude_Code_Style**: The specific UI styling that matches Anthropic's Claude Code CLI interface

## Requirements

### Requirement 1: Extract Tool Message Component

**User Story:** As a developer, I want tool message rendering logic extracted into a reusable component, so that the code is more maintainable and the component can be reused across different screens.

#### Acceptance Criteria

1. WHEN tool UI logic is extracted, THE ToolMessage component SHALL render tool calls with the same visual style as the current implementation
2. WHEN a tool is running, THE ToolMessage component SHALL display the tool name, parameters, and a gray dimmed dot
3. WHEN a tool completes successfully, THE ToolMessage component SHALL display a green dot with tool results
4. WHEN a tool fails, THE ToolMessage component SHALL display a red dot with error information
5. WHEN tool results contain multiple lines (like Bash output), THE ToolMessage component SHALL format them with proper indentation and expand info
6. THE ToolMessage component SHALL accept a Msg object with toolInfo as props
7. THE ToolMessage component SHALL maintain the exact Claude Code styling (⏺ symbol, ⎿ prefix, spacing, colors)
8. THE formatToolCallParts function SHALL be extracted to a separate utility module
9. THE formatToolResult function SHALL be extracted to a separate utility module

### Requirement 2: Refactor MyChatScreen

**User Story:** As a developer, I want MyChatScreen to use the extracted ToolMessage component, so that the code is cleaner and more focused on chat logic.

#### Acceptance Criteria

1. WHEN MyChatScreen renders tool messages, THE system SHALL use the extracted ToolMessage component
2. WHEN MyChatScreen is refactored, THE chat functionality SHALL remain unchanged
3. WHEN tool messages are displayed, THE visual appearance SHALL be identical to the current implementation
4. THE MyChatScreen SHALL no longer contain the renderToolMessage function
5. THE MyChatScreen SHALL import and use the ToolMessage component
6. THE MyChatScreen file size SHALL be reduced by at least 50 lines after refactoring

### Requirement 3: Create Tool Examples Screen

**User Story:** As a developer, I want a dedicated ToolExamplesScreen, so that I can debug and test different tool UI states without running actual tool executions.

#### Acceptance Criteria

1. WHEN the ToolExamplesScreen loads, THE system SHALL display various tool UI examples in a scrollable list
2. WHEN displaying examples, THE system SHALL show tools in different states (running, completed, error)
3. WHEN showing Bash tool examples, THE system SHALL demonstrate proper multi-line output formatting with expand info
4. WHEN showing different tool types, THE system SHALL include Read, Write, Edit, Bash, Glob, Grep, Search examples
5. THE ToolExamplesScreen SHALL use the same ToolMessage component as MyChatScreen
6. THE ToolExamplesScreen SHALL be accessible via a new entry point in the application
7. WHEN examples are displayed, THE system SHALL show realistic tool parameters and results
8. THE ToolExamplesScreen SHALL include examples of edge cases (empty results, very long output, special characters)
9. THE ToolExamplesScreen SHALL have a title and description explaining its purpose

### Requirement 4: Component API and Utilities

**User Story:** As a developer, I want a clean and intuitive API for the tool components and utilities, so that they are easy to use and maintain.

#### Acceptance Criteria

1. THE ToolMessage component SHALL accept a `message` prop of type Msg with required toolInfo
2. THE ToolMessage component SHALL be a pure component (no side effects or state)
3. WHEN tool status changes, THE component SHALL re-render with updated styling automatically
4. THE formatToolCallParts function SHALL be exported from `src/utils/toolFormatting.ts`
5. THE formatToolResult function SHALL be exported from `src/utils/toolFormatting.ts`
6. THE component and utilities SHALL have complete TypeScript type definitions
7. THE ToolMessage component SHALL handle edge cases (missing toolInfo fields) gracefully
8. THE utilities SHALL include JSDoc comments with usage examples

### Requirement 5: File Organization and Entry Point

**User Story:** As a developer, I want the new components organized in a logical file structure with proper entry points, so that they are easy to find and access.

#### Acceptance Criteria

1. THE ToolMessage component SHALL be placed in `src/components/tool/ToolMessage.tsx`
2. THE tool formatting utilities SHALL be placed in `src/utils/toolFormatting.ts`
3. THE ToolExamplesScreen SHALL be placed in `src/screens/ToolExamplesScreen.tsx`
4. THE ToolExamplesScreen SHALL have a new entry point in `src/entrypoints/tool-examples.tsx`
5. WHEN components are created, THE system SHALL follow existing naming conventions
6. THE components SHALL export proper TypeScript interfaces for their props
7. THE entry point SHALL be runnable via npm script (e.g., `npm run tool-examples`)

### Requirement 6: Testing and Quality

**User Story:** As a developer, I want the extracted components to be well-tested, so that refactoring doesn't introduce bugs.

#### Acceptance Criteria

1. THE ToolMessage component SHALL have unit tests covering all tool states
2. THE formatToolCallParts function SHALL have unit tests for all tool types
3. THE formatToolResult function SHALL have unit tests for different result formats
4. WHEN tests are run, THE coverage SHALL be at least 90% for new components
5. THE ToolExamplesScreen SHALL have basic rendering tests
6. THE tests SHALL verify that visual output matches the original implementation