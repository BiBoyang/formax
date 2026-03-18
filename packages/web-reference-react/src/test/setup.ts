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
