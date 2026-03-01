import { describe, expect, it } from 'vitest'
import type React from 'react'
import { render } from 'ink-testing-library'
import { __testOnlyAskUserQuestionToolBlock } from '../../components/tool/AskUserQuestionToolBlock'

type Q = {
  question: string
  header: string
  options: Array<{ label: string; description: string }>
  multiSelect: boolean
}

type S = {
  cursor: number
  selected: number[]
  other: string
  typing: boolean
  typingValue: string
}

function applyStateReducer(
  reducer: (setState: React.Dispatch<React.SetStateAction<S[]>>) => void,
  initial: S[],
): S[] {
  let state = initial
  const setState = ((updater: React.SetStateAction<S[]>) => {
    state = typeof updater === 'function' ? (updater as (prev: S[]) => S[])(state) : updater
  }) as React.Dispatch<React.SetStateAction<S[]>>
  reducer(setState)
  return state
}

describe('AskUserQuestionToolBlock helpers', () => {
  it('toggles multi options on/off and clears other text', () => {
    const init: S[] = [
      { cursor: 0, selected: [0], other: 'x', typing: false, typingValue: '' },
      { cursor: 0, selected: [], other: 'keep', typing: false, typingValue: '' },
    ]
    const afterAdd = applyStateReducer(
      (setState) => __testOnlyAskUserQuestionToolBlock.toggleMultiOption(1, 1, setState as any),
      init,
    )
    expect(afterAdd[0].other).toBe('x')
    expect(afterAdd[1].selected).toEqual([1])
    expect(afterAdd[1].other).toBe('')

    const afterDel = applyStateReducer(
      (setState) => __testOnlyAskUserQuestionToolBlock.toggleMultiOption(1, 1, setState as any),
      afterAdd,
    )
    expect(afterDel[1].selected).toEqual([])
  })

  it('selects single option and advances tab index', () => {
    const state: S[] = [
      { cursor: 0, selected: [], other: 'keep', typing: false, typingValue: '' },
      { cursor: 0, selected: [], other: '', typing: false, typingValue: '' },
    ]
    let tab = 0
    const setState = ((updater: React.SetStateAction<S[]>) => {
      const next = typeof updater === 'function' ? (updater as (p: S[]) => S[])(state) : updater
      state.splice(0, state.length, ...next)
    }) as React.Dispatch<React.SetStateAction<S[]>>
    const setActiveTab = ((updater: React.SetStateAction<number>) => {
      tab = typeof updater === 'function' ? (updater as (p: number) => number)(tab) : updater
    }) as React.Dispatch<React.SetStateAction<number>>

    __testOnlyAskUserQuestionToolBlock.selectSingleAndAdvance(1, 2, 1, setState as any, setActiveTab as any)
    expect(state[0].other).toBe('keep')
    expect(state[1].selected).toEqual([2])
    expect(state[1].typing).toBe(false)
    expect(tab).toBe(1)
  })

  it('enterTyping/enterTypingWithText/commitTyping transitions correctly', () => {
    const init: S[] = [{ cursor: 0, selected: [0], other: 'old', typing: false, typingValue: '' }]
    const afterEnter = applyStateReducer(
      (setState) => __testOnlyAskUserQuestionToolBlock.enterTyping(0, 3, setState as any),
      init,
    )
    expect(afterEnter[0].typing).toBe(true)
    expect(afterEnter[0].cursor).toBe(3)
    expect(afterEnter[0].typingValue).toBe('old')

    const afterType = applyStateReducer(
      (setState) => __testOnlyAskUserQuestionToolBlock.enterTypingWithText(0, 3, 'X', setState as any),
      afterEnter,
    )
    expect(afterType[0].typingValue.endsWith('X')).toBe(true)

    const afterCommit = applyStateReducer(
      (setState) => __testOnlyAskUserQuestionToolBlock.commitTyping(0, setState as any),
      afterType,
    )
    expect(afterCommit[0].typing).toBe(false)
    expect(afterCommit[0].typingValue).toBe('')
    expect(afterCommit[0].other).toContain('X')
    expect(afterCommit[0].selected).toEqual([])
  })

  it('commitTyping keeps state untouched when not typing', () => {
    const init: S[] = [{ cursor: 0, selected: [1], other: 'x', typing: false, typingValue: '' }]
    const out = applyStateReducer(
      (setState) => __testOnlyAskUserQuestionToolBlock.commitTyping(0, setState as any),
      init,
    )
    expect(out).toEqual(init)
  })

  it('commitTyping handles undefined typingValue via empty fallback', () => {
    const init: S[] = [{ cursor: 0, selected: [], other: '', typing: true, typingValue: undefined as any }]
    const out = applyStateReducer(
      (setState) => __testOnlyAskUserQuestionToolBlock.commitTyping(0, setState as any),
      init,
    )
    expect(out[0].other).toBe('')
    expect(out[0].typing).toBe(false)
  })

  it('computes cursor bounds, clamp, truncate and answer formatting', () => {
    const single: Q = {
      question: 'q',
      header: 'h',
      options: [{ label: 'A', description: '' }, { label: 'B', description: '' }],
      multiSelect: false,
    }
    const multi: Q = { ...single, multiSelect: true }

    expect(__testOnlyAskUserQuestionToolBlock.maxCursorForQuestion(single as any)).toBe(2)
    expect(__testOnlyAskUserQuestionToolBlock.maxCursorForQuestion(multi as any)).toBe(2)

    expect(__testOnlyAskUserQuestionToolBlock.clamp(5, 0, 3)).toBe(3)
    expect(__testOnlyAskUserQuestionToolBlock.clamp(-1, 0, 3)).toBe(0)

    expect(__testOnlyAskUserQuestionToolBlock.truncate('short', 10)).toBe('short')
    expect(__testOnlyAskUserQuestionToolBlock.truncate('123456', 5)).toBe('1234...')

    expect(__testOnlyAskUserQuestionToolBlock.formatAnswerForSubmit(single as any, undefined)).toBe('')
    expect(
      __testOnlyAskUserQuestionToolBlock.formatAnswerForSubmit(single as any, {
        cursor: 0,
        selected: [1],
        other: '',
        typing: false,
        typingValue: '',
      } as any),
    ).toBe('B')
    expect(
      __testOnlyAskUserQuestionToolBlock.formatAnswerForSubmit(single as any, {
        cursor: 0,
        selected: [],
        other: '  custom  ',
        typing: false,
        typingValue: '',
      } as any),
    ).toBe('custom')
    expect(
      __testOnlyAskUserQuestionToolBlock.formatAnswerForSubmit(multi as any, {
        cursor: 0,
        selected: [0, 1],
        other: '',
        typing: false,
        typingValue: '',
      } as any),
    ).toBe('A, B')
    expect(
      __testOnlyAskUserQuestionToolBlock.formatAnswerForDisplay(single as any, {
        cursor: 0,
        selected: [0],
        other: '',
        typing: false,
        typingValue: '',
      } as any),
    ).toBe('A')
    expect(__testOnlyAskUserQuestionToolBlock.truncate(undefined as any, 4)).toBe('')
    expect(
      __testOnlyAskUserQuestionToolBlock.formatAnswerForSubmit(single as any, {
        cursor: 0,
        selected: [99],
        other: '',
        typing: false,
        typingValue: '',
      } as any),
    ).toBe('')
  })

  it('renders internal rows/pages for edge display branches', () => {
    const q = {
      question: 'Q?',
      header: '',
      options: [{ label: 'A', description: '' }],
      multiSelect: false,
    }
    const qp = render(
      __testOnlyAskUserQuestionToolBlock.QuestionPage({
        q: q as any,
        s: undefined,
      }) as any,
    )
    expect(qp.lastFrame()).toContain('Type something.')

    const rp = render(
      __testOnlyAskUserQuestionToolBlock.ReviewPage({
        questions: [q as any],
        answeredStrings: [''],
        cursor: 1,
        showUnansweredWarning: true,
      }) as any,
    )
    expect(rp.lastFrame()).toContain('You have not answered all questions')
    expect(rp.lastFrame()).toContain('Cancel')

    const op = render(
      __testOnlyAskUserQuestionToolBlock.OptionRow({
        index: 1,
        isCursor: true,
        multi: false,
        selected: true,
        label: 'A',
        description: 'desc',
      }) as any,
    )
    expect(op.lastFrame()).toContain('A')
    expect(op.lastFrame()).toContain('✓')
    expect(op.lastFrame()).toContain('desc')

    const qpSelected = render(
      __testOnlyAskUserQuestionToolBlock.QuestionPage({
        q: q as any,
        s: {
          cursor: 0,
          selected: [0],
          other: '',
          typing: false,
          typingValue: '',
        } as any,
      }) as any,
    )
    expect(qpSelected.lastFrame()).toContain('A')
  })
})
