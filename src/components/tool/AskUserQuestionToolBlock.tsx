import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Box, Text } from 'ink'
import { getTheme } from '../../shared/utils/theme'
import { useUserInputManager } from '../../tools/runtime/userInputContext'
import { useReplUi } from '../../features/repl/replUiContext'
import { useScopeActivation, useScopedInput } from '../../features/repl/inputScopeContext'
import {
  fieldIdForAskQuestion,
  type PresentationAskQuestion,
} from '../../features/tools/presentation/askQuestions'

type AskQuestion = PresentationAskQuestion

type QuestionState = {
  cursor: number
  selected: number[]
  other: string
  typing: boolean
  typingValue: string
}

function createInitialQuestionState(): QuestionState {
  return {
    cursor: 0,
    selected: [],
    other: '',
    typing: false,
    typingValue: '',
  }
}

export function AskUserQuestionToolBlock({
  toolUseId,
  questions,
}: {
  toolUseId: string
  questions: AskQuestion[]
}): React.ReactNode {
  const theme = getTheme()
  const userInput = useUserInputManager()
  const replUi = useReplUi()

  if (!userInput || questions.length === 0) {
    return (
      <Box flexDirection="column">
        <Text color={theme.secondaryText}>Preparing questions…</Text>
      </Box>
    )
  }

  return (
    <InteractiveAsk
      toolUseId={toolUseId}
      questions={questions}
      onSubmit={(out) => userInput.submitAnswers(toolUseId, out)}
      onAbort={() => (replUi ? replUi.abort() : userInput.reject(toolUseId, new Error('Canceled')))}
    />
  )
}

function InteractiveAsk({
  toolUseId,
  questions,
  onSubmit,
  onAbort,
}: {
  toolUseId: string
  questions: AskQuestion[]
  onSubmit: (answers: Record<string, string>) => void
  onAbort: () => void
}): React.ReactNode {
  const theme = getTheme()
  const scope = 'prompt:askUserQuestion'
  useScopeActivation(scope)

  const [activeTab, setActiveTab] = useState(0) // 0..questions.length (submit tab)
  const [reviewCursor, setReviewCursor] = useState(0) // 0 submit / 1 cancel
  const [isSubmitting, setIsSubmitting] = useState(false)
  const submittedRef = useRef(false)
  const [state, setState] = useState<QuestionState[]>(() => questions.map(() => createInitialQuestionState()))

  const submitTab = questions.length
  const isSubmitTab = activeTab >= submitTab
  const currentQ = questions[activeTab]
  const currentS = state[activeTab]

  useEffect(() => {
    setState((prev) => {
      if (prev.length === questions.length) return prev
      if (prev.length > questions.length) return prev.slice(0, questions.length)
      return [...prev, ...Array.from({ length: questions.length - prev.length }, () => createInitialQuestionState())]
    })
    setActiveTab((tab) => clamp(tab, 0, questions.length))
  }, [questions.length])

  const answeredStrings = useMemo(() => questions.map((q, i) => formatAnswerForDisplay(q, state[i])), [questions, state])
  const answeredForSubmit = useMemo(() => questions.map((q, i) => formatAnswerForSubmit(q, state[i])), [questions, state])
  const answeredFlags = useMemo(() => answeredForSubmit.map((s) => Boolean(s.trim())), [answeredForSubmit])
  const allAnswered = useMemo(() => answeredFlags.every(Boolean), [answeredFlags])

  const goPrevTab = useCallback(() => {
    setReviewCursor(0)
    setActiveTab((t) => Math.max(0, t - 1))
  }, [])

  const goNextTab = useCallback(() => {
    setReviewCursor(0)
    setActiveTab((t) => Math.min(submitTab, t + 1))
  }, [submitTab])

  const submitAll = useCallback(() => {
    if (submittedRef.current) return
    submittedRef.current = true
    setIsSubmitting(true)
    const out: Record<string, string> = {}
    for (let i = 0; i < questions.length; i++) {
      const key = fieldIdForAskQuestion(questions[i], i)
      out[key] = formatAnswerForSubmit(questions[i], state[i])
    }
    onSubmit(out)
  }, [onSubmit, questions, state])

  useScopedInput(
    scope,
    (input, key) => {
      if (!key) return

      // Global cancel
      if (key.escape) {
        if (isSubmitting) return
        onAbort()
        return
      }

      if (isSubmitting) return

      // Typing mode (single-select only)
      if (!isSubmitTab && currentQ && currentS && !currentQ.multiSelect && currentS.typing) {
        if (key.upArrow || key.downArrow) {
          const delta = key.upArrow ? -1 : 1
          setState((prev) =>
            prev.map((s, i) => {
              if (i !== activeTab) return s
              const nextCursor = clamp(s.cursor + delta, 0, maxCursorForQuestion(currentQ))
              const leavingOtherRow = nextCursor !== currentQ.options.length
              return { ...s, cursor: nextCursor, typing: leavingOtherRow ? false : s.typing }
            }),
          )
          return
        }

        if (key.return) {
          commitTyping(activeTab, setState)
          setActiveTab((t) => Math.min(submitTab, t + 1))
          return
        }

        if (key.backspace || key.delete) {
          setState((prev) =>
            prev.map((s, i) => {
              if (i !== activeTab) return s
              return { ...s, typingValue: s.typingValue.slice(0, -1) }
            }),
          )
          return
        }

        if (input && !key.ctrl && !key.meta) {
          setState((prev) =>
            prev.map((s, i) => {
              if (i !== activeTab) return s
              return { ...s, typingValue: s.typingValue + input }
            }),
          )
        }
        return
      }

      // Tab / left-right navigation
      if (key.tab || key.leftArrow || key.rightArrow) {
        if (key.leftArrow) goPrevTab()
        else goNextTab()
        return
      }

      // Submit tab
      if (isSubmitTab) {
        if (key.upArrow) setReviewCursor((c) => clamp(c - 1, 0, 1))
        if (key.downArrow) setReviewCursor((c) => clamp(c + 1, 0, 1))
        if (key.return) {
          if (reviewCursor === 0) submitAll()
          else onAbort()
        }
        return
      }

      // Up/down move cursor within question
      if (key.upArrow) {
        setState((prev) =>
          prev.map((s, i) => {
            if (i !== activeTab) return s
            return { ...s, cursor: clamp(s.cursor - 1, 0, maxCursorForQuestion(currentQ)) }
          }),
        )
        return
      }
      if (key.downArrow) {
        setState((prev) =>
          prev.map((s, i) => {
            if (i !== activeTab) return s
            return { ...s, cursor: clamp(s.cursor + 1, 0, maxCursorForQuestion(currentQ)) }
          }),
        )
        return
      }

      // Single-select: start editing when cursor is on "Type something." (including digits)
      if (
        !currentQ.multiSelect &&
        currentS.cursor >= currentQ.options.length &&
        input &&
        input !== '0' &&
        !key.ctrl &&
        !key.meta
      ) {
        enterTypingWithText(activeTab, currentQ.options.length, input, setState)
        return
      }

      // Numeric selection shortcut
      if (/^[0-9]$/.test(input)) {
        const n = Number.parseInt(input, 10)
        if (!Number.isFinite(n) || n < 1) {
          // Allow other handlers (e.g. 0 shortcut) to run.
        } else {
          const idx = n - 1
          if (currentQ.multiSelect) {
            if (idx >= 0 && idx < currentQ.options.length) {
              toggleMultiOption(activeTab, idx, setState)
            }
            return
          }

          // Single select: last row is "Type something."
          if (idx === currentQ.options.length) {
            enterTyping(activeTab, currentQ.options.length, setState)
            return
          }
          if (idx >= 0 && idx < currentQ.options.length) {
            selectSingleAndAdvance(activeTab, idx, submitTab, setState, setActiveTab)
            return
          }
        }
      }

      // Single-select: quick jump to custom text (0 / t)
      if (!currentQ.multiSelect && (input === '0' || input === 't' || input === 'T')) {
        if (input === '0') {
          enterTyping(activeTab, currentQ.options.length, setState)
          return
        }
        enterTypingWithText(activeTab, currentQ.options.length, input, setState)
        return
      }

      // Multi-select: Space toggles option
      if (currentQ.multiSelect && input === ' ') {
        if (currentS.cursor < currentQ.options.length) {
          toggleMultiOption(activeTab, currentS.cursor, setState)
        }
        return
      }

      // Enter confirms
      if (key.return) {
        if (currentQ.multiSelect) {
          if (currentS.cursor >= currentQ.options.length) {
            setActiveTab((t) => Math.min(submitTab, t + 1))
            return
          }
          toggleMultiOption(activeTab, currentS.cursor, setState)
          return
        }

        // Single-select
        if (currentS.cursor >= currentQ.options.length) {
          enterTyping(activeTab, currentQ.options.length, setState)
          return
        }
        selectSingleAndAdvance(activeTab, currentS.cursor, submitTab, setState, setActiveTab)
        return
      }
    },
  )

  const chipLine = (
    <Box>
      <Text color={theme.secondaryText}>&lt;-  </Text>
      {questions.map((q, i) => {
        const active = activeTab === i
        const mark = answeredFlags[i] ? '☒' : '☐'
        return (
          <Box key={`${toolUseId}-${q.header || i}`} marginRight={1}>
            <Text inverse={active} color={active ? theme.text : theme.secondaryText}>
              {mark} {truncate(q.header || `Q${i + 1}`, 12)}
            </Text>
          </Box>
        )
      })}
      <Box marginLeft={1}>
        <Text inverse={isSubmitTab} color={isSubmitTab ? theme.text : theme.secondaryText}>
          ✓ Submit
        </Text>
      </Box>
      <Text color={theme.secondaryText}>  -&gt;</Text>
    </Box>
  )

  return (
    <Box flexDirection="column">
      {chipLine}

      <Box marginTop={1} flexDirection="column">
        {isSubmitTab ? (
          <ReviewPage
            questions={questions}
            answeredStrings={answeredStrings}
            cursor={reviewCursor}
            showUnansweredWarning={!allAnswered}
          />
        ) : (
          <QuestionPage q={currentQ as AskQuestion} s={currentS} />
        )}
      </Box>

      <Box marginTop={1}>
        <Text color={theme.secondaryText}>
          Enter to select · Space to toggle · Tab/Arrow keys to navigate · Esc to cancel
        </Text>
      </Box>
    </Box>
  )
}

function QuestionPage({ q, s }: { q: AskQuestion; s: QuestionState | undefined }): React.ReactNode {
  const theme = getTheme()
  const state = s ?? { cursor: 0, selected: [], other: '', typing: false, typingValue: '' }
  const selectedSingle = !q.multiSelect && state.selected.length === 1 ? state.selected[0] : null
  const otherIsAnswer = !q.multiSelect && state.selected.length === 0 && Boolean(state.other.trim())

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>{q.question}</Text>
      </Box>

      <Box flexDirection="column">
        {q.options.map((o, i) => {
          const isCursor = state.cursor === i
          const isSelected = q.multiSelect ? state.selected.includes(i) : selectedSingle === i

          return (
            <OptionRow
              key={`${i}-${o.label}`}
              index={i + 1}
              isCursor={isCursor}
              multi={q.multiSelect}
              selected={isSelected}
              label={o.label}
              description={o.description}
            />
          )
        })}

        {q.multiSelect ? (
          <Box marginTop={1}>
            <Text color={theme.secondaryText}>{state.cursor === q.options.length ? '> ' : '  '}</Text>
            <Text bold>Submit</Text>
          </Box>
        ) : (
          <OtherRow
            index={q.options.length + 1}
            isCursor={state.cursor === q.options.length}
            isAnswer={otherIsAnswer}
            typing={state.typing}
            draft={state.typingValue}
            value={state.other}
          />
        )}
      </Box>
    </Box>
  )
}

function ReviewPage({
  questions,
  answeredStrings,
  cursor,
  showUnansweredWarning,
}: {
  questions: AskQuestion[]
  answeredStrings: string[]
  cursor: number
  showUnansweredWarning: boolean
}): React.ReactNode {
  const theme = getTheme()

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>Review your answers</Text>
      </Box>

      {showUnansweredWarning ? (
        <Box marginBottom={1}>
          <Text color={theme.warning}>⚠ You have not answered all questions</Text>
        </Box>
      ) : null}

      <Box flexDirection="column" marginBottom={1}>
        {questions.map((q, i) => (
          <Box key={q.header || String(i)} flexDirection="column" marginBottom={1}>
            <Text>
              <Text color={theme.secondaryText}> ● </Text>
              {q.question}
            </Text>
            <Text>
              <Text color={theme.secondaryText}>   </Text>
              <Text color={theme.success}>→ {answeredStrings[i] || ''}</Text>
            </Text>
          </Box>
        ))}
      </Box>

      <Box marginBottom={1}>
        <Text>Ready to submit your answers?</Text>
      </Box>

      <Box flexDirection="column">
        <MenuRow isCursor={cursor === 0} label="Submit answers" />
        <MenuRow isCursor={cursor === 1} label="Cancel" />
      </Box>
    </Box>
  )
}

function MenuRow({ isCursor, label }: { isCursor: boolean; label: string }): React.ReactNode {
  const theme = getTheme()
  return (
    <Box>
      <Text>{isCursor ? '> ' : '  '}</Text>
      <Text color={isCursor ? theme.text : theme.secondaryText}>{label}</Text>
    </Box>
  )
}

function OptionRow({
  index,
  isCursor,
  multi,
  selected,
  label,
  description,
}: {
  index: number
  isCursor: boolean
  multi: boolean
  selected: boolean
  label: string
  description: string
}): React.ReactNode {
  const theme = getTheme()
  const prefix = isCursor ? '>' : ' '
  const mark = multi ? (selected ? '[✓]' : '[ ]') : ''
  const tail = !multi && selected ? ' ✓' : ''

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={theme.secondaryText}>{prefix} </Text>
        <Text color={theme.secondaryText}>{index}. </Text>
        {multi ? <Text color={selected ? theme.success : theme.secondaryText}>{mark} </Text> : null}
        <Text color={!multi && selected ? theme.success : undefined} bold={selected}>
          {label}
          {tail}
        </Text>
      </Box>
      {description ? (
        <Box marginLeft={5}>
          <Text color={theme.secondaryText}>{description}</Text>
        </Box>
      ) : null}
    </Box>
  )
}

function OtherRow({
  index,
  isCursor,
  isAnswer,
  value,
  draft,
  typing,
}: {
  index: number
  isCursor: boolean
  isAnswer: boolean
  value: string
  draft: string
  typing: boolean
}): React.ReactNode {
  const theme = getTheme()
  const prefix = isCursor ? '>' : ' '
  const committed = value || ''
  const hasCommitted = Boolean(committed.trim())
  const hasDraft = Boolean((draft || '').length > 0)
  const tail = !typing && isAnswer ? ' ✓' : ''

  const displayText = typing
    ? `${draft}|`
    : hasCommitted
      ? committed
      : hasDraft
        ? draft + (isCursor ? '|' : '')
        : `Type something.${isCursor ? '|' : ''}`

  const color = typing ? theme.text : isAnswer ? theme.success : theme.secondaryText

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={theme.secondaryText}>{prefix} </Text>
        <Text color={theme.secondaryText}>{index}. </Text>
        <Text color={color} bold={typing || isAnswer}>
          {displayText}
          {tail}
        </Text>
      </Box>
    </Box>
  )
}

function toggleMultiOption(
  qi: number,
  optIndex: number,
  setState: React.Dispatch<React.SetStateAction<QuestionState[]>>,
): void {
  setState((prev) =>
    prev.map((s, i) => {
      if (i !== qi) return s
      const set = new Set(s.selected)
      if (set.has(optIndex)) set.delete(optIndex)
      else set.add(optIndex)
      return { ...s, selected: Array.from(set).sort((a, b) => a - b), other: '' }
    }),
  )
}

function selectSingleAndAdvance(
  qi: number,
  optIndex: number,
  submitTab: number,
  setState: React.Dispatch<React.SetStateAction<QuestionState[]>>,
  setActiveTab: React.Dispatch<React.SetStateAction<number>>,
): void {
  setState((prev) =>
    prev.map((s, i) => {
      if (i !== qi) return s
      return { ...s, selected: [optIndex], typing: false }
    }),
  )
  setActiveTab((t) => Math.min(submitTab, t + 1))
}

function enterTyping(
  qi: number,
  cursor: number,
  setState: React.Dispatch<React.SetStateAction<QuestionState[]>>,
): void {
  setState((prev) =>
    prev.map((s, i) => {
      if (i !== qi) return s
      return { ...s, cursor, typing: true, typingValue: s.typingValue || s.other || '', selected: [] }
    }),
  )
}

function enterTypingWithText(
  qi: number,
  cursor: number,
  text: string,
  setState: React.Dispatch<React.SetStateAction<QuestionState[]>>,
): void {
  setState((prev) =>
    prev.map((s, i) => {
      if (i !== qi) return s
      const base = s.typing ? s.typingValue : s.typingValue || s.other || ''
      return { ...s, cursor, typing: true, typingValue: base + text, selected: [] }
    }),
  )
}

function commitTyping(
  qi: number,
  setState: React.Dispatch<React.SetStateAction<QuestionState[]>>,
): void {
  setState((prev) =>
    prev.map((s, i) => {
      if (i !== qi) return s
      if (!s.typing) return s
      const text = (s.typingValue || '').trim()
      return {
        ...s,
        typing: false,
        typingValue: '',
        other: text,
        selected: [],
      }
    }),
  )
}

function maxCursorForQuestion(q: AskQuestion): number {
  // multi: last row is "Submit"; single: last row is "Type something."
  return q.multiSelect ? q.options.length : q.options.length
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

function truncate(s: string, max: number): string {
  const str = s || ''
  if (str.length <= max) return str
  return str.slice(0, max - 1) + '...'
}

function formatAnswerForSubmit(q: AskQuestion, s: QuestionState | undefined): string {
  if (!s) return ''
  if (q.multiSelect) {
    return s.selected.map((i) => q.options[i]?.label).filter(Boolean).join(', ')
  }
  if (s.selected.length === 1) return q.options[s.selected[0]]?.label || ''
  if (s.other.trim()) return s.other.trim()
  return ''
}

function formatAnswerForDisplay(q: AskQuestion, s: QuestionState | undefined): string {
  return formatAnswerForSubmit(q, s)
}

export const __testOnlyAskUserQuestionToolBlock = {
  InteractiveAsk,
  QuestionPage,
  ReviewPage,
  OptionRow,
  OtherRow,
  toggleMultiOption,
  selectSingleAndAdvance,
  enterTyping,
  enterTypingWithText,
  commitTyping,
  maxCursorForQuestion,
  clamp,
  truncate,
  formatAnswerForSubmit,
  formatAnswerForDisplay,
}
