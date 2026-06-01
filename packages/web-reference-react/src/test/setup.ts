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
