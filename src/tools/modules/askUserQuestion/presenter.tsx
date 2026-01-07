import React, { useCallback, useMemo, useRef, useState } from 'react'
import { Box, Text, useInput } from 'ink'
import { getTheme } from '../../../utils/theme'
import type { ToolPresenter } from '../../presenters/types'
import { FallbackToolPresenter } from '../../presenters/fallback'
import type { Msg } from '../../../components/tool/ToolMessage'
import { useUserInputManager } from '../../runtime/userInputContext'
import { useReplUi } from '../../../features/repl/replUiContext'

export const AskUserQuestionToolPresenter: ToolPresenter = ({ message }: { message: Msg }) => {
  const theme = getTheme()
  const userInput = useUserInputManager()
  const replUi = useReplUi()

  if (!message.toolInfo) return <FallbackToolPresenter message={message} />

  const { input, status } = message.toolInfo
  const dotColor =
    status === 'error' ? theme.error : status === 'completed' ? theme.success : theme.secondaryText

  const toolUseId = message.id.startsWith('tool-') ? message.id.slice('tool-'.length) : message.id
  const questions = parseQuestions(input)
  const answers = parseAnswers(typeof message.toolInfo.result === 'string' ? message.toolInfo.result : '')

  if (status === 'running') {
    if (!userInput || questions.length === 0) {
      return (
        <Box flexDirection="column" marginTop={1}>
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

  const resultStr = typeof message.toolInfo.result === 'string' ? message.toolInfo.result : ''
  if (status === 'error' && resultStr.includes('Request aborted')) {
    return null
  }

  return (
    <Box flexDirection="column" marginTop={1} marginBottom={0}>
      <Box>
        <Text color={dotColor}>⏺</Text>
        <Text bold>AskUserQuestion</Text>
        <Text color={theme.secondaryText}>(</Text>
        <Text color={theme.secondaryText}>{String(questions.length || 1)} questions</Text>
        <Text color={theme.secondaryText}>)</Text>
      </Box>

      {answers ? (
        <Box flexDirection="column">
          <Box>
            <Text color={theme.secondaryText}>⎿  </Text>
            <Text>Answered</Text>
          </Box>
          {Object.entries(answers).map(([k, v]) => (
            <Box key={k}>
              <Text color={theme.secondaryText}>   {k}: </Text>
              <Text>{v}</Text>
            </Box>
          ))}
        </Box>
      ) : (
        <Box flexDirection="column">
          <Text color={theme.secondaryText}>⎿  </Text>
          <Text color={theme.secondaryText}>No answers</Text>
        </Box>
      )}
    </Box>
  )
}

type AskOption = { label: string; description: string }
type AskQuestion = {
  question: string
  header: string
  options: AskOption[]
  multiSelect: boolean
}

type QuestionState = {
  cursor: number
  selected: number[]
  other: string
  typing: boolean
  typingValue: string
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

  const [activeTab, setActiveTab] = useState(0) // 0..questions.length (submit tab)
  const [reviewCursor, setReviewCursor] = useState(0) // 0 submit / 1 cancel
  const [isSubmitting, setIsSubmitting] = useState(false)
  const submittedRef = useRef(false)
  const [state, setState] = useState<QuestionState[]>(() =>
    questions.map((q) => ({
      cursor: 0,
      selected: [],
      other: '',
      typing: false,
      typingValue: '',
    })),
  )

  const submitTab = questions.length
  const isSubmitTab = activeTab >= submitTab
  const currentQ = questions[activeTab]
  const currentS = state[activeTab]

  const answeredStrings = useMemo(() => questions.map((q, i) => formatAnswerForDisplay(q, state[i])), [questions, state])
  const answeredForSubmit = useMemo(() => questions.map((q, i) => formatAnswerForSubmit(q, state[i])), [questions, state])
  const answeredFlags = useMemo(() => answeredForSubmit.map((s) => Boolean(s.trim())), [answeredForSubmit])

  const goPrevTab = useCallback(() => {
    setReviewCursor(0)
    setActiveTab((t) => (t <= 0 ? submitTab : t - 1))
  }, [submitTab])

  const goNextTab = useCallback(() => {
    setReviewCursor(0)
    setActiveTab((t) => (t >= submitTab ? 0 : t + 1))
  }, [submitTab])

  const submitAll = useCallback(() => {
    if (submittedRef.current) return
    submittedRef.current = true
    setIsSubmitting(true)
    const out: Record<string, string> = {}
    for (let i = 0; i < questions.length; i++) {
      const key = questions[i].header || `Q${i + 1}`
      out[key] = formatAnswerForSubmit(questions[i], state[i])
    }
    onSubmit(out)
  }, [onSubmit, questions, state])

  useInput(
    (input, key) => {
      if (!key) return

      // Global cancel
      if (key.escape) {
        onAbort()
        return
      }

      if (isSubmitting) return

      if (!isSubmitTab && currentQ && currentS && !currentQ.multiSelect && currentS.typing) {
        if (key.tab || key.leftArrow || key.rightArrow) {
          commitTyping(activeTab, setState)
        }
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

      if (!currentQ || !currentS) return

      // Typing mode (single-select only)
      if (!currentQ.multiSelect && currentS.typing) {
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

      // Single-select: quick jump to custom text
      if (!currentQ.multiSelect && (input === '0' || input === 't' || input === 'T')) {
        enterTyping(activeTab, currentQ.options.length, setState)
        return
      }

      // Numeric selection shortcut
      if (/^[0-9]$/.test(input)) {
        const n = Number.parseInt(input, 10)
        if (Number.isFinite(n) && n >= 1) {
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
          }
        }
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
    { isActive: true },
  )

  const chipLine = (
    <Box>
      <Text color={theme.secondaryText}>←  </Text>
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
      <Text color={theme.secondaryText}>  →</Text>
    </Box>
  )

  return (
    <Box flexDirection="column" marginTop={1}>
      {chipLine}

      <Box marginTop={1} flexDirection="column">
        {isSubmitTab ? (
          <ReviewPage questions={questions} answeredStrings={answeredStrings} cursor={reviewCursor} />
        ) : currentQ ? (
          <QuestionPage q={currentQ} s={currentS} />
        ) : null}
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

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>{q.question}</Text>
      </Box>

      <Box flexDirection="column">
        {q.options.map((o, i) => {
          const isCursor = state.cursor === i
          const isSelected = q.multiSelect
            ? state.selected.includes(i)
            : state.selected.length === 1 && state.selected[0] === i && !state.other

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
            <Text color={theme.secondaryText}>{state.cursor === q.options.length ? '❯ ' : '  '}</Text>
            <Text bold>Submit</Text>
          </Box>
        ) : (
          <OtherRow
            index={q.options.length + 1}
            isCursor={state.cursor === q.options.length}
            selected={Boolean(state.other.trim())}
            typing={state.typing}
            typingValue={state.typingValue}
            typed={state.other}
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
}: {
  questions: AskQuestion[]
  answeredStrings: string[]
  cursor: number
}): React.ReactNode {
  const theme = getTheme()

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>Review your answers</Text>
      </Box>

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
      <Text>{isCursor ? '❯ ' : '  '}</Text>
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
  const prefix = isCursor ? '❯' : ' '
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
  selected,
  typed,
  typing,
  typingValue,
}: {
  index: number
  isCursor: boolean
  selected: boolean
  typed: string
  typing: boolean
  typingValue: string
}): React.ReactNode {
  const theme = getTheme()
  const prefix = isCursor ? '❯' : ' '
  const hasText = Boolean((typed || '').trim())

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={theme.secondaryText}>{prefix} </Text>
        <Text color={theme.secondaryText}>{index}. </Text>
        <Text color={hasText || selected ? theme.success : theme.secondaryText} bold={hasText || selected}>
          {typing ? `${typingValue}▏` : hasText ? typed : 'Type something.'}
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
      return { ...s, selected: [optIndex], other: '', typing: false, typingValue: '' }
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
      return { ...s, cursor, typing: true, typingValue: s.other || '', selected: [] }
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
  return str.slice(0, max - 1) + '…'
}

function formatAnswerForSubmit(q: AskQuestion, s: QuestionState | undefined): string {
  if (!s) return ''
  if (q.multiSelect) {
    return s.selected.map((i) => q.options[i]?.label).filter(Boolean).join(', ')
  }
  if (s.other.trim()) return s.other.trim()
  if (s.selected.length === 1) return q.options[s.selected[0]]?.label || ''
  return ''
}

function formatAnswerForDisplay(q: AskQuestion, s: QuestionState | undefined): string {
  return formatAnswerForSubmit(q, s)
}

function parseQuestions(input: unknown): AskQuestion[] {
  const raw = Array.isArray((input as any)?.questions) ? ((input as any).questions as any[]) : []
  return raw.map((q: any, i: number) => {
    const header = String(q?.header || `Q${i + 1}`)
    const opts = Array.isArray(q?.options)
      ? q.options.map((o: any) => ({
          label: String(o?.label ?? ''),
          description: String(o?.description ?? ''),
        }))
      : []
    return {
      question: String(q?.question ?? ''),
      header,
      options: opts,
      multiSelect: Boolean(q?.multiSelect),
    }
  })
}

function parseAnswers(raw: string): Record<string, string> | null {
  const trimmed = (raw || '').trim()
  if (!trimmed) return null
  try {
    const parsed = JSON.parse(trimmed)
    const answers = parsed?.answers
    if (!answers || typeof answers !== 'object') return null
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(answers)) out[String(k)] = String(v)
    return out
  } catch {
    return null
  }
}
