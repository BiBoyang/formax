import { expect as vitestExpect } from 'vitest'
import * as jestDomMatchers from '@testing-library/jest-dom/matchers'

vitestExpect.extend(jestDomMatchers)

const globalExpect = (globalThis as { expect?: typeof vitestExpect }).expect
if (globalExpect && globalExpect !== vitestExpect) {
  globalExpect.extend(jestDomMatchers)
}

if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false
}

if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = () => undefined
}

if (!Element.prototype.releasePointerCapture) {
  Element.prototype.releasePointerCapture = () => undefined
}

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => undefined
}

if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = function scrollTo(options?: ScrollToOptions | number) {
    if (typeof options === 'number') {
      ;(this as Element & { scrollTop?: number }).scrollTop = options
      return undefined
    }
    ;(this as Element & { scrollTop?: number }).scrollTop = Number(options?.top ?? 0)
    ;(this as Element & { scrollLeft?: number }).scrollLeft = Number(options?.left ?? 0)
    return undefined
  }
}

if (typeof ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    constructor(_callback?: ResizeObserverCallback) {}

    observe() {
      return undefined
    }

    unobserve() {
      return undefined
    }

    disconnect() {
      return undefined
    }
  }
}

if (
  typeof CSSStyleSheet !== 'undefined' &&
  !CSSStyleSheet.prototype.replaceSync
) {
  CSSStyleSheet.prototype.replaceSync = function replaceSync() {
    return undefined
  }
}

function createMemoryStorage(): Storage {
  const store = new Map<string, string>()
  return {
    get length() {
      return store.size
    },
    clear() {
      store.clear()
    },
    getItem(key: string) {
      return store.get(key) ?? null
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null
    },
    removeItem(key: string) {
      store.delete(key)
    },
    setItem(key: string, value: string) {
      store.set(key, value)
    },
  }
}

function ensureWindowStorage(name: 'localStorage' | 'sessionStorage') {
  let currentStorage: Storage | undefined
  try {
    currentStorage = window[name]
  } catch {
    currentStorage = undefined
  }

  if (!currentStorage) {
    Object.defineProperty(window, name, {
      configurable: true,
      value: createMemoryStorage(),
    })
  }
}

ensureWindowStorage('localStorage')
ensureWindowStorage('sessionStorage')
