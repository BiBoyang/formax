# Implementation Plan: Tool UI Refactor

## Overview

This implementation plan breaks down the tool UI refactoring into discrete, manageable tasks. The approach follows a bottom-up strategy: first creating utility functions, then the ToolMessage component, followed by the ToolExamplesScreen, and finally refactoring MyChatScreen to use the new components.

## Tasks

- [x] 1. Extract and test tool formatting utilities
- [x] 1.1 Create toolFormatting.ts utility module
  - Extract formatToolCallParts function from MyChatScreen.tsx
  - Extract formatToolResult function from MyChatScreen.tsx
  - Add proper TypeScript types and JSDoc comments
  - _Requirements: 1.8, 1.9, 4.4, 4.5, 4.8_

- [x] 1.2 Write property tests for formatToolCallParts
  - **Property 5: Tool Formatting Utility Consistency**
  - **Validates: Requirements 1.8, 1.9**

- [x] 1.3 Write property tests for formatToolResult
  - **Property 6: Result Formatting Utility Consistency**
  - **Validates: Requirements 1.8, 1.9**

- [x] 1.4 Write unit tests for utility edge cases
  - Test empty inputs, special characters, very long output
  - Test unknown tool types and malformed data
  - _Requirements: 4.7_

- [x] 2. Create ToolMessage component
- [x] 2.1 Create ToolMessage component with TypeScript interfaces
  - Create src/components/tool/ToolMessage.tsx
  - Define ToolMessageProps interface
  - Import and use toolFormatting utilities
  - Implement pure functional component
  - _Requirements: 1.1, 1.6, 4.1, 4.2_

- [x] 2.2 Implement tool status rendering logic
  - Handle running, completed, and error states
  - Implement proper dot coloring (gray/green/red)
  - Maintain exact Claude Code styling
  - _Requirements: 1.2, 1.3, 1.4, 1.7_

- [x] 2.3 Implement multi-line output formatting
  - Handle Bash tool output with proper indentation
  - Implement middleLines rendering with 3-space indent
  - Add expandInfo display without indentation
  - _Requirements: 1.5_

- [x] 2.4 Write property tests for ToolMessage component
  - **Property 1: Visual Consistency Across All Tool States**
  - **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.7, 2.3**

- [x] 2.5 Write property tests for multi-line formatting
  - **Property 2: Multi-line Output Formatting**
  - **Validates: Requirements 1.5**

- [x] 2.6 Write property tests for edge case handling
  - **Property 3: Graceful Edge Case Handling**
  - **Validates: Requirements 4.7**

- [x] 3. Create ToolExamplesScreen
- [x] 3.1 Create ToolExamplesScreen component
  - Create src/screens/ToolExamplesScreen.tsx
  - Design example data structure with all tool types
  - Include examples for running, completed, and error states
  - _Requirements: 3.1, 3.2, 3.4_

- [x] 3.2 Add comprehensive tool examples
  - Add Read, Write, Edit, Bash, Glob, Grep, Search examples
  - Include multi-line Bash output examples with expand info
  - Add edge case examples (empty results, long output, special characters)
  - _Requirements: 3.3, 3.4, 3.8_

- [x] 3.3 Add screen title and description
  - Add explanatory title and description for the screen purpose
  - Implement scrollable layout for examples
  - _Requirements: 3.9_

- [x] 3.4 Write unit tests for ToolExamplesScreen
  - Test basic rendering and example data validation
  - Verify all tool types and states are represented
  - _Requirements: 3.1, 3.2, 3.4, 3.8, 3.9_

- [x] 4. Create entry point for ToolExamplesScreen
- [x] 4.1 Create tool-examples entry point
  - Create src/entrypoints/tool-examples.tsx
  - Set up proper Ink app structure
  - Add exit handling and basic navigation
  - _Requirements: 5.4, 5.7_

- [x] 4.2 Add npm script for tool-examples
  - Update package.json with tool-examples script
  - Test that entry point runs correctly
  - _Requirements: 5.7_

- [x] 5. Checkpoint - Test extracted components
- Ensure all tests pass, verify components work independently, ask the user if questions arise.

- [x] 6. Refactor MyChatScreen to use ToolMessage component
- [x] 6.1 Update MyChatScreen imports and remove old functions
  - Import ToolMessage component
  - Remove renderToolMessage function
  - Remove formatToolCallParts and formatToolResult functions
  - _Requirements: 2.1, 2.4, 2.5_

- [x] 6.2 Replace tool message rendering with ToolMessage component
  - Update message rendering logic to use ToolMessage component
  - Ensure proper prop passing (message object)
  - Maintain exact same visual appearance
  - _Requirements: 2.1, 2.3_

- [x] 6.3 Write integration tests for refactored MyChatScreen
  - **Property 4: Chat Functionality Preservation**
  - **Validates: Requirements 2.2**

- [x] 7. Final validation and cleanup
- [x] 7.1 Run comprehensive test suite
  - Execute all unit tests and property tests
  - Verify 90% code coverage for new components
  - Run visual regression tests
  - _Requirements: 6.1, 6.2, 6.3, 6.4_

- [x] 7.2 Verify file organization and documentation
  - Confirm all files are in correct locations
  - Verify TypeScript types are properly exported
  - Check JSDoc comments are complete
  - _Requirements: 5.1, 5.2, 5.3, 5.5, 5.6, 4.6, 4.8_

- [x] 8. Final checkpoint - Complete system test
- Ensure all tests pass, verify both MyChatScreen and ToolExamplesScreen work correctly, ask the user if questions arise.

## Notes

- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases
- The refactoring maintains exact visual compatibility with the original implementation
- All tasks are required for comprehensive implementation with full testing coverage