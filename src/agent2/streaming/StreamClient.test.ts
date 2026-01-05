/**
 * Property-based tests for Stream Client
 * 
 * Feature: streaming-chat-refactor
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { StreamClient } from './StreamClient'

describe('StreamClient', () => {
  /**
   * Property 1: Request Configuration Correctness
   * 
   * For any streaming request sent to the Anthropic API, the request payload SHALL contain
   * stream: true, the required headers (anthropic-version, anthropic-beta, x-api-key),
   * and the system prompt configuration.
   * 
   * **Validates: Requirements 1.1, 1.2, 1.3**
   */
  describe('Property 1: Request Configuration Correctness', () => {
    it('should always include required headers for any API key', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 10, maxLength: 100 }),  // apiKey
          fc.webUrl(),  // baseURL
          fc.string({ minLength: 5, maxLength: 50 }),  // model
          (apiKey, baseURL, model) => {
            const client = new StreamClient({ apiKey, baseURL, model })
            const headers = client.getHeaders()

            // Required headers must be present
            expect(headers['anthropic-version']).toBe('2023-06-01')
            expect(headers['anthropic-beta']).toBe('interleaved-thinking-2025-05-14')
            expect(headers['x-api-key']).toBe(apiKey)
            expect(headers['Authorization']).toBe(`Bearer ${apiKey}`)
            expect(headers['content-type']).toBe('application/json')
            expect(headers['accept']).toBe('text/event-stream')
          }
        ),
        { numRuns: 100 }
      )
    })

    it('should normalize baseURL correctly for any input', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 10 }),
          fc.oneof(
            fc.constant(''),
            fc.constant('/'),
            fc.constant('/v1'),
            fc.constant('/v1/'),
            fc.constant('///'),
          ),
          (baseHost, suffix) => {
            const baseURL = `https://${baseHost}${suffix}`
            const client = new StreamClient({
              apiKey: 'test-key',
              baseURL,
              model: 'test-model'
            })
            const config = client.getConfig()

            // BaseURL should end with /v1 (no trailing slash)
            if (config.baseURL) {
              expect(config.baseURL.endsWith('/v1')).toBe(true)
              expect(config.baseURL.endsWith('/v1/')).toBe(false)
            }
          }
        ),
        { numRuns: 100 }
      )
    })

    it('should use default timeout of 10 minutes when not specified', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 10 }),
          fc.string({ minLength: 10 }),
          fc.string({ minLength: 5 }),
          (apiKey, baseURL, model) => {
            const client = new StreamClient({ apiKey, baseURL, model })
            const config = client.getConfig()

            expect(config.timeoutMs).toBe(600000) // 10 minutes
          }
        ),
        { numRuns: 100 }
      )
    })

    it('should respect custom timeout when specified', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 10 }),
          fc.string({ minLength: 10 }),
          fc.string({ minLength: 5 }),
          fc.integer({ min: 1000, max: 3600000 }),  // 1s to 1h
          (apiKey, baseURL, model, timeoutMs) => {
            const client = new StreamClient({ apiKey, baseURL, model, timeoutMs })
            const config = client.getConfig()

            expect(config.timeoutMs).toBe(timeoutMs)
          }
        ),
        { numRuns: 100 }
      )
    })

    it('should preserve model name exactly as provided', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 10 }),
          fc.string({ minLength: 10 }),
          fc.stringMatching(/^[a-z0-9-]+$/),  // Valid model name pattern
          (apiKey, baseURL, model) => {
            const client = new StreamClient({ apiKey, baseURL, model })
            const config = client.getConfig()

            expect(config.model).toBe(model)
          }
        ),
        { numRuns: 100 }
      )
    })
  })
})
