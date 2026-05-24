import { describe, expect, it } from 'vitest'
import { DEFAULT_MAX_AUTO_TITLE_MESSAGE_COUNT, shouldGenerateSessionTitle } from './policy'

describe('shouldGenerateSessionTitle', () => {
  it('rejects when labeled, attempted, or missing candidate text', () => {
    expect(
      shouldGenerateSessionTitle({
        hasLabel: true,
        attemptedInProcess: false,
        candidateUserText: 'hello',
        messageCount: 1,
      }),
    ).toBe(false)

    expect(
      shouldGenerateSessionTitle({
        hasLabel: false,
        attemptedInProcess: true,
        candidateUserText: 'hello',
        messageCount: 1,
      }),
    ).toBe(false)

    expect(
      shouldGenerateSessionTitle({
        hasLabel: false,
        attemptedInProcess: false,
        candidateUserText: '   ',
        messageCount: 1,
      }),
    ).toBe(false)
  })

  it('enforces message count limits and supports custom max', () => {
    expect(
      shouldGenerateSessionTitle({
        hasLabel: false,
        attemptedInProcess: false,
        candidateUserText: 'title me',
        messageCount: DEFAULT_MAX_AUTO_TITLE_MESSAGE_COUNT + 1,
      }),
    ).toBe(false)

    expect(
      shouldGenerateSessionTitle({
        hasLabel: false,
        attemptedInProcess: false,
        candidateUserText: 'title me',
        messageCount: 5,
      }),
    ).toBe(true)

    expect(
      shouldGenerateSessionTitle({
        hasLabel: false,
        attemptedInProcess: false,
        candidateUserText: 'title me',
        messageCount: 3,
        maxMessageCount: 2,
      }),
    ).toBe(false)
  })

  it('blocks protected title sources and exhausted retry budgets', () => {
    expect(
      shouldGenerateSessionTitle({
        hasLabel: false,
        titleSource: 'manual',
        attemptedInProcess: false,
        candidateUserText: 'title me',
        messageCount: 1,
      }),
    ).toBe(false)
    expect(
      shouldGenerateSessionTitle({
        hasLabel: false,
        titleSource: 'legacy',
        attemptedInProcess: false,
        candidateUserText: 'title me',
        messageCount: 1,
      }),
    ).toBe(false)
    expect(
      shouldGenerateSessionTitle({
        hasLabel: false,
        attemptedInProcess: false,
        candidateUserText: 'title me',
        messageCount: 1,
        failedAttemptCount: 3,
      }),
    ).toBe(false)
    expect(
      shouldGenerateSessionTitle({
        hasLabel: false,
        attemptedInProcess: false,
        candidateUserText: 'title me',
        messageCount: 1,
        failedAttemptCount: 2,
      }),
    ).toBe(true)
  })
})
