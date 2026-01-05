import { describe, it, expect } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import { ToolExamplesScreen, exampleMessages } from './ToolExamplesScreen'

/**
 * Tests for ToolExamplesScreen
 * Validates: Requirements 3.1, 3.2, 3.4, 3.8, 3.9
 */
describe('ToolExamplesScreen', () => {
  describe('basic rendering', () => {
    it('should render without crashing', () => {
      const { lastFrame } = render(<ToolExamplesScreen />)
      expect(lastFrame()).toBeDefined()
    })

    it('should display title', () => {
      const { lastFrame } = render(<ToolExamplesScreen />)
      expect(lastFrame()).toContain('Tool UI Examples')
    })

    it('should display description', () => {
      const { lastFrame } = render(<ToolExamplesScreen />)
      expect(lastFrame()).toContain('debugging purposes')
    })

    it('should display exit instructions', () => {
      const { lastFrame } = render(<ToolExamplesScreen />)
      expect(lastFrame()).toContain("Press 'q' to exit")
    })
  })

  describe('tool type sections', () => {
    it('should display Read Tool section', () => {
      const { lastFrame } = render(<ToolExamplesScreen />)
      expect(lastFrame()).toContain('Read Tool')
    })

    it('should display Write Tool section', () => {
      const { lastFrame } = render(<ToolExamplesScreen />)
      expect(lastFrame()).toContain('Write Tool')
    })

    it('should display Edit Tool section', () => {
      const { lastFrame } = render(<ToolExamplesScreen />)
      expect(lastFrame()).toContain('Edit Tool')
    })

    it('should display Bash Tool section', () => {
      const { lastFrame } = render(<ToolExamplesScreen />)
      expect(lastFrame()).toContain('Bash Tool')
    })

    it('should display Glob Tool section', () => {
      const { lastFrame } = render(<ToolExamplesScreen />)
      expect(lastFrame()).toContain('Glob Tool')
    })

    it('should display Grep Tool section', () => {
      const { lastFrame } = render(<ToolExamplesScreen />)
      expect(lastFrame()).toContain('Grep Tool')
    })

    it('should display Search Tool section', () => {
      const { lastFrame } = render(<ToolExamplesScreen />)
      expect(lastFrame()).toContain('Search Tool')
    })

    it('should display Edge Cases section', () => {
      const { lastFrame } = render(<ToolExamplesScreen />)
      expect(lastFrame()).toContain('Edge Cases')
    })
  })

  describe('example data validation', () => {
    it('should have examples for all tool types', () => {
      const toolTypes = ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'Search']
      
      toolTypes.forEach(toolType => {
        const hasExample = exampleMessages.some(m => m.toolInfo?.name === toolType)
        expect(hasExample).toBe(true)
      })
    })

    it('should have examples for all states', () => {
      const states = ['running', 'completed', 'error']
      
      states.forEach(state => {
        const hasState = exampleMessages.some(m => m.toolInfo?.status === state)
        expect(hasState).toBe(true)
      })
    })

    it('should have edge case examples', () => {
      const edgeCases = exampleMessages.filter(m => m.id.startsWith('edge-'))
      expect(edgeCases.length).toBeGreaterThan(0)
    })

    it('should have multi-line Bash example with expand info', () => {
      const bashMultiLine = exampleMessages.find(m => 
        m.toolInfo?.name === 'Bash' && 
        m.toolInfo?.middleLines && 
        m.toolInfo?.expandInfo
      )
      expect(bashMultiLine).toBeDefined()
    })

    it('should have unicode example', () => {
      const unicodeExample = exampleMessages.find(m => m.id === 'edge-unicode')
      expect(unicodeExample).toBeDefined()
      expect(unicodeExample?.toolInfo?.input.file_path).toContain('文件')
    })

    it('should have special characters example', () => {
      const specialCharsExample = exampleMessages.find(m => m.id === 'edge-special-chars')
      expect(specialCharsExample).toBeDefined()
    })
  })

  describe('tool message rendering', () => {
    it('should render ⏺ symbols for tool messages', () => {
      const { lastFrame } = render(<ToolExamplesScreen />)
      expect(lastFrame()).toContain('⏺')
    })

    it('should render ⎿ prefix for completed tools', () => {
      const { lastFrame } = render(<ToolExamplesScreen />)
      expect(lastFrame()).toContain('⎿')
    })

    it('should render file paths in Read examples', () => {
      const { lastFrame } = render(<ToolExamplesScreen />)
      expect(lastFrame()).toContain('src/components/Button.tsx')
    })

    it('should render commands in Bash examples', () => {
      const { lastFrame } = render(<ToolExamplesScreen />)
      expect(lastFrame()).toContain('npm run build')
    })

    it('should render patterns in Glob examples', () => {
      const { lastFrame } = render(<ToolExamplesScreen />)
      expect(lastFrame()).toContain('**/*.tsx')
    })
  })
})
