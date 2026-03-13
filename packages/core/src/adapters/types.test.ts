import { describe, expect, it, vi } from 'vitest'
import { createNoopLogger, createSystemClock } from './types.js'

describe('adapters/types', () => {
  it('createNoopLogger exposes all methods and does not throw', () => {
    const logger = createNoopLogger()

    expect(typeof logger.log).toBe('function')
    expect(typeof logger.debug).toBe('function')
    expect(typeof logger.info).toBe('function')
    expect(typeof logger.warn).toBe('function')
    expect(typeof logger.error).toBe('function')

    expect(() => logger.log('info', 'm', { k: 1 })).not.toThrow()
    expect(() => logger.debug('d')).not.toThrow()
    expect(() => logger.info('i')).not.toThrow()
    expect(() => logger.warn('w')).not.toThrow()
    expect(() => logger.error('e')).not.toThrow()
  })

  it('createSystemClock delegates to Date.now', () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(123456)
    try {
      const clock = createSystemClock()
      expect(clock.nowMs()).toBe(123456)
      expect(nowSpy).toHaveBeenCalledTimes(1)
    } finally {
      nowSpy.mockRestore()
    }
  })
})
