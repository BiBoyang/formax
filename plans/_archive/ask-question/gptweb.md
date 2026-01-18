收到，你补的这份 `AskUserQuestion` 模块代码已经够我把“Claude Code 同款交互 UI”落地了（你现在的 handler / spec / 静态 presenter 都在这份文件里）。

下面给你一套**不改协议**（handler / UserInputManager 的 requestAnswers/submitAnswers/reject 都不动）的重构方案：核心是把交互做进 `AskUserQuestionToolPresenter`，并通过一个很薄的 React Context 把 `userInputManager` 注入给 presenter，这样 presenter 才能在 UI 里直接 `submitAnswers(toolUseId, answers)`（你现有测试就是这么提交的）。

---

## 1) 新增：UserInputManager 注入（给 presenter 用）

> 目的：不改数据协议，但让 presenter 能拿到 `userInputManager.submitAnswers/reject`。

新增文件：`src/tools/runtime/userInputContext.tsx`

```tsx
import React, { createContext, useContext } from 'react'
import type { UserInputManager } from './userInputManager'

const Ctx = createContext<UserInputManager | null>(null)

export function UserInputProvider({
  userInput,
  children,
}: {
  userInput: UserInputManager
  children: React.ReactNode
}) {
  return <Ctx.Provider value={userInput}>{children}</Ctx.Provider>
}

export function useUserInputManager() {
  return useContext(Ctx)
}
```

### 在你的 App 根组件/入口处包一层 Provider

你项目里创建 `userInputManager` 的地方（你描述是在 runtime/controller 那一套），保持原来的实例不变，只是加一层：

```tsx
import React, { useMemo } from 'react'
import { UserInputProvider } from './tools/runtime/userInputContext'
import { createUserInputManager } from './tools/runtime/userInputManager'
import { REPL } from './screens/REPL'

export function App() {
  const userInput = useMemo(() => createUserInputManager(), [])

  return (
    <UserInputProvider userInput={userInput}>
      <REPL userInput={userInput} />
    </UserInputProvider>
  )
}
```

> `AskUserQuestion` module 仍然照旧把 handler/presenter 注册进去（你现在就是这么做的）。

---

## 2) 替换：交互式 `AskUserQuestionToolPresenter`（完整代码）

直接用下面这个**整文件**替换你当前的 `src/tools/modules/askUserQuestion/presenter.tsx`（你现在这个文件是静态展示 + “0) Other”）。

它实现了你截图里的关键点：

* 顶部 Chips：每题一个 + 最后 “✓ Submit”，左右/Tab 切换
* 选项区：↑/↓ 导航，Enter 选择；多选 Space 切换
* `0` 或 `T`：进入 “Type something” 输入模式
* Submit 页：Review answers + “Submit answers / Cancel”
* Esc：取消整套流程（reject）
* 底部提示：和你截图一致

```tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Box, Text, useFocus, useFocusManager, useInput } from 'ink'
import { getTheme } from '../../../utils/theme'
import type { ToolPresenter } from '../../presenters/types'
import { FallbackToolPresenter } from '../../presenters/fallback'
import type { Msg } from '../../../components/tool/ToolMessage'
import { useUserInputManager } from '../../runtime/userInputContext'

type AskOption = { label: string; description: string }
type AskQuestion = {
  question: string
  header: string
  options: AskOption[]
  multiSelect: boolean
}

type SelectedItem =
  | { type: 'option'; index: number }
  | { type: 'other'; text: string }

type QuestionState = {
  cursor: number
  selected: SelectedItem[]
  typing: boolean
  typingValue: string
}

const SUBMIT_TAB = -1

export const AskUserQuestionToolPresenter: ToolPresenter = ({ message }: { message: Msg }) => {
  const theme = getTheme()
  const userInput = useUserInputManager()

  if (!message.toolInfo) return <FallbackToolPresenter message={message} />

  const { input, status } = message.toolInfo
  const dotColor =
    status === 'error' ? theme.error : status === 'completed' ? theme.success : theme.secondaryText

  const questions = useMemo(() => {
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
      } as AskQuestion
    })
  }, [input])

  const answers = parseAnswers(typeof message.toolInfo.result === 'string' ? message.toolInfo.result : '')

  // tool_use_id 在你的 handler 返回里就是 call.id（tool_use_id: call.id）:contentReference[oaicite:4]{index=4}
  const toolUseId = String(
    (message.toolInfo as any)?.tool_use_id ??
      (message.toolInfo as any)?.toolUseId ??
      (message.toolInfo as any)?.id ??
      '',
  )

  // 已完成/报错：保持你现在的展示逻辑（兼容旧行为）
  if (status !== 'running') {
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
          <Box>
            <Text color={theme.secondaryText}>⎿  </Text>
            <Text color={theme.secondaryText}>No answers</Text>
          </Box>
        )}
      </Box>
    )
  }

  // 运行中但缺少注入：降级（避免卡死）
  if (!userInput || !toolUseId || questions.length === 0) {
    return <FallbackToolPresenter message={message} />
  }

  return (
    <InteractiveAsk
      toolUseId={toolUseId}
      questions={questions}
      onSubmit={(out) => userInput.submitAnswers(toolUseId, out)}
      onCancel={(err) => userInput.reject(toolUseId, err)}
    />
  )
}

function InteractiveAsk({
  toolUseId,
  questions,
  onSubmit,
  onCancel,
}: {
  toolUseId: string
  questions: AskQuestion[]
  onSubmit: (answers: Record<string, string>) => void
  onCancel: (error: Error) => void
}) {
  const theme = getTheme()
  const focusId = `ask-${toolUseId}`
  const { focus } = useFocusManager()
  const { isFocused } = useFocus({ id: focusId })

  const chipBg = (theme as any).accent ?? (theme as any).primary ?? 'magenta'
  const chipFg = (theme as any).background ?? 'black'

  const [activeTab, setActiveTab] = useState<number>(questions.length ? 0 : SUBMIT_TAB)
  const [reviewCursor, setReviewCursor] = useState(0) // 0 submit / 1 cancel
  const [state, setState] = useState<QuestionState[]>(() =>
    questions.map((q) => ({
      cursor: 0,
      selected: [],
      typing: false,
      typingValue: '',
    })),
  )

  const activeTabRef = useRef(activeTab)
  useEffect(() => {
    activeTabRef.current = activeTab
  }, [activeTab])

  useEffect(() => {
    focus(focusId)
  }, [focus, focusId])

  const answeredStrings = useMemo(() => {
    return questions.map((q, i) => formatAnswerForDisplay(q, state[i]))
  }, [questions, state])

  const answeredForSubmit = useMemo(() => {
    return questions.map((q, i) => formatAnswerForSubmit(q, state[i]))
  }, [questions, state])

  const answeredFlags = useMemo(() => answeredForSubmit.map((s) => Boolean(s.trim())), [answeredForSubmit])

  const goPrevTab = useCallback(() => {
    setReviewCursor(0)
    setActiveTab((t) => {
      if (t === SUBMIT_TAB) return Math.max(0, questions.length - 1)
      return t <= 0 ? SUBMIT_TAB : t - 1
    })
  }, [questions.length])

  const goNextTab = useCallback(() => {
    setReviewCursor(0)
    setActiveTab((t) => {
      if (t === SUBMIT_TAB) return 0
      return t >= questions.length - 1 ? SUBMIT_TAB : t + 1
    })
  }, [questions.length])

  const enterTyping = useCallback(
    (qi: number) => {
      setState((prev) =>
        prev.map((s, i) => {
          if (i !== qi) return s
          const curOther = findOther(s.selected)
          return {
            ...s,
            cursor: questions[qi].options.length, // other row
            typing: true,
            typingValue: curOther?.text ?? '',
          }
        }),
      )
    },
    [questions],
  )

  const exitTyping = useCallback((qi: number, commit: boolean) => {
    setState((prev) =>
      prev.map((s, i) => {
        if (i !== qi) return s
        if (!s.typing) return s

        if (!commit) {
          return { ...s, typing: false, typingValue: '' }
        }

        const text = (s.typingValue || '').trim()
        const q = questions[qi]

        let nextSelected = s.selected.filter((it) => it.type !== 'other')
        if (text) {
          if (q.multiSelect) {
            nextSelected = [...nextSelected, { type: 'other', text }]
          } else {
            nextSelected = [{ type: 'other', text }]
          }
        }

        return {
          ...s,
          typing: false,
          typingValue: '',
          selected: nextSelected,
        }
      }),
    )
  }, [questions])

  const toggleOption = useCallback(
    (qi: number, optIndex: number) => {
      setState((prev) =>
        prev.map((s, i) => {
          if (i !== qi) return s
          const q = questions[qi]

          if (!q.multiSelect) {
            return { ...s, selected: [{ type: 'option', index: optIndex }] }
          }

          const exists = s.selected.some((it) => it.type === 'option' && it.index === optIndex)
          const next = exists
            ? s.selected.filter((it) => !(it.type === 'option' && it.index === optIndex))
            : [...s.selected, { type: 'option', index: optIndex }]

          return { ...s, selected: next }
        }),
      )
    },
    [questions],
  )

  const moveCursor = useCallback((qi: number, delta: number) => {
    setState((prev) =>
      prev.map((s, i) => {
        if (i !== qi) return s
        const max = questions[qi].options.length // last is other
        const next = clamp(s.cursor + delta, 0, max)
        return { ...s, cursor: next }
      }),
    )
  }, [questions])

  const jumpCursor = useCallback((qi: number, next: number) => {
    setState((prev) =>
      prev.map((s, i) => {
        if (i !== qi) return s
        const max = questions[qi].options.length
        return { ...s, cursor: clamp(next, 0, max) }
      }),
    )
  }, [questions])

  const commitSingleAndAdvance = useCallback((qi: number) => {
    if (qi >= questions.length - 1) {
      setReviewCursor(0)
      setActiveTab(SUBMIT_TAB)
      return
    }
    setActiveTab(qi + 1)
  }, [questions.length])

  const submitAll = useCallback(() => {
    const out: Record<string, string> = {}
    for (let i = 0; i < questions.length; i++) {
      const k = questions[i].header || `Q${i + 1}`
      out[k] = formatAnswerForSubmit(questions[i], state[i])
    }
    onSubmit(out)
  }, [onSubmit, questions, state])

  useInput((input, key) => {
    if (!isFocused) return

    // 全局取消
    if (key.escape) {
      onCancel(new Error('Canceled'))
      return
    }

    // Tab / 左右切题
    if (key.tab || key.leftArrow || key.rightArrow) {
      if (key.leftArrow) goPrevTab()
      else goNextTab()
      return
    }

    // Submit 页
    if (activeTabRef.current === SUBMIT_TAB) {
      if (key.upArrow) setReviewCursor((c) => clamp(c - 1, 0, 1))
      if (key.downArrow) setReviewCursor((c) => clamp(c + 1, 0, 1))
      if (key.return) {
        if (reviewCursor === 0) submitAll()
        else onCancel(new Error('Canceled'))
      }
      return
    }

    const qi = activeTabRef.current
    const q = questions[qi]
    const s = state[qi]

    // 输入模式
    if (s?.typing) {
      if (key.return) {
        exitTyping(qi, true)
        if (!q.multiSelect) commitSingleAndAdvance(qi)
        return
      }
      if (key.backspace || key.delete) {
        setState((prev) =>
          prev.map((x, i) => {
            if (i !== qi) return x
            return { ...x, typingValue: x.typingValue.slice(0, -1) }
          }),
        )
        return
      }
      // 允许 Esc 已在上面全局处理；这里处理普通字符
      if (input) {
        setState((prev) =>
          prev.map((x, i) => {
            if (i !== qi) return x
            return { ...x, typingValue: x.typingValue + input }
          }),
        )
      }
      return
    }

    // 上下移动
    if (key.upArrow) return moveCursor(qi, -1)
    if (key.downArrow) return moveCursor(qi, 1)

    // 0 / T 进入 other 输入
    if (input === '0' || input === 't' || input === 'T') {
      enterTyping(qi)
      return
    }

    // 数字直接选（1-4）
    if (/^[1-9]$/.test(input)) {
      const n = Number(input)
      const idx = n - 1
      if (idx >= 0 && idx < q.options.length) {
        toggleOption(qi, idx)
        if (!q.multiSelect) commitSingleAndAdvance(qi)
        return
      }
    }

    // Space 多选切换
    if (key.space) {
      if (q.multiSelect) {
        if (s.cursor < q.options.length) toggleOption(qi, s.cursor)
        else enterTyping(qi)
      }
      return
    }

    // Enter 确认
    if (key.return) {
      if (s.cursor < q.options.length) {
        toggleOption(qi, s.cursor)
        if (!q.multiSelect) commitSingleAndAdvance(qi)
        return
      }
      // other row
      enterTyping(qi)
      return
    }
  })

  const activeQuestion = activeTab === SUBMIT_TAB ? null : questions[activeTab]
  const activeState = activeTab === SUBMIT_TAB ? null : state[activeTab]

  return (
    <Box flexDirection="column" marginTop={1}>
      {/* 顶部 chips */}
      <Box>
        <Text color={theme.secondaryText}>←  </Text>

        {questions.map((q, i) => {
          const active = activeTab === i
          const mark = answeredFlags[i] ? '☒' : '☐'
          return (
            <Box key={q.header || String(i)} marginRight={1}>
              <Text
                backgroundColor={active ? chipBg : undefined}
                color={active ? chipFg : theme.secondaryText}
              >
                {mark} {truncate(q.header || `Q${i + 1}`, 12)}
              </Text>
            </Box>
          )
        })}

        <Box marginLeft={1}>
          <Text
            backgroundColor={activeTab === SUBMIT_TAB ? chipBg : undefined}
            color={activeTab === SUBMIT_TAB ? chipFg : theme.secondaryText}
          >
            ✓ Submit
          </Text>
        </Box>

        <Text color={theme.secondaryText}>  →</Text>
      </Box>

      <Box marginTop={1} flexDirection="column">
        {activeTab === SUBMIT_TAB ? (
          <ReviewPage
            questions={questions}
            answeredStrings={answeredStrings}
            cursor={reviewCursor}
            theme={theme}
          />
        ) : (
          <QuestionPage
            q={activeQuestion!}
            s={activeState!}
            answered={answeredFlags[activeTab]}
            theme={theme}
          />
        )}
      </Box>

      <Box marginTop={1}>
        <Text color={theme.secondaryText}>Enter to select · Tab/Arrow keys to navigate · Esc to cancel</Text>
      </Box>
    </Box>
  )
}

function QuestionPage({
  q,
  s,
  theme,
}: {
  q: AskQuestion
  s: QuestionState
  answered: boolean
  theme: any
}) {
  const other = findOther(s.selected)

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>{q.question}</Text>
      </Box>

      <Box flexDirection="column">
        {q.options.map((o, i) => {
          const isCursor = s.cursor === i
          const isSelected = s.selected.some((it) => it.type === 'option' && it.index === i)
          return (
            <OptionRow
              key={`${i}-${o.label}`}
              index={i + 1}
              isCursor={isCursor}
              multi={q.multiSelect}
              selected={isSelected}
              label={o.label}
              description={o.description}
              theme={theme}
            />
          )
        })}

        {/* other row */}
        <OtherRow
          index={q.options.length + 1}
          isCursor={s.cursor === q.options.length}
          multi={q.multiSelect}
          selected={Boolean(other?.text)}
          typed={other?.text ?? ''}
          typing={s.typing}
          typingValue={s.typingValue}
          theme={theme}
        />
      </Box>
    </Box>
  )
}

function ReviewPage({
  questions,
  answeredStrings,
  cursor,
  theme,
}: {
  questions: AskQuestion[]
  answeredStrings: string[]
  cursor: number
  theme: any
}) {
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
        <MenuRow isCursor={cursor === 0} label="Submit answers" theme={theme} />
        <MenuRow isCursor={cursor === 1} label="Cancel" theme={theme} />
      </Box>
    </Box>
  )
}

function MenuRow({ isCursor, label, theme }: { isCursor: boolean; label: string; theme: any }) {
  return (
    <Box>
      <Text>{isCursor ? '❯ ' : '  '}</Text>
      <Text color={isCursor ? undefined : theme.secondaryText}>{label}</Text>
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
  theme,
}: {
  index: number
  isCursor: boolean
  multi: boolean
  selected: boolean
  label: string
  description: string
  theme: any
}) {
  const prefix = isCursor ? '❯' : ' '
  const mark = multi ? (selected ? '[✔]' : '[ ]') : ''
  const tail = !multi && selected ? ` ${'✔'}` : ''

  return (
    <Box flexDirection="column">
      <Box>
        <Text>{prefix} </Text>
        <Text>{index}. </Text>
        {multi ? <Text color={selected ? theme.success : theme.secondaryText}>{mark} </Text> : null}
        <Text color={!multi && selected ? theme.success : undefined}>
          {label}
          {tail}
        </Text>
      </Box>
      {description ? (
        <Box>
          <Text color={theme.secondaryText}>     {description}</Text>
        </Box>
      ) : null}
    </Box>
  )
}

function OtherRow({
  index,
  isCursor,
  multi,
  selected,
  typed,
  typing,
  typingValue,
  theme,
}: {
  index: number
  isCursor: boolean
  multi: boolean
  selected: boolean
  typed: string
  typing: boolean
  typingValue: string
  theme: any
}) {
  const prefix = isCursor ? '❯' : ' '
  const hasText = Boolean((typed || '').trim())

  // 参考你截图的两行样式：选中时上面只显示 [✔]，下面显示输入内容
  if (multi) {
    return (
      <Box flexDirection="column">
        <Box>
          <Text>{prefix} </Text>
          <Text>{index}. </Text>
          <Text color={selected ? theme.success : theme.secondaryText}>{selected ? '[✔]' : '[ ]'} </Text>
        </Box>
        <Box>
          <Text color={theme.secondaryText}>     </Text>
          <Text color={hasText ? undefined : theme.secondaryText}>
            {typing ? `${typingValue}▏` : hasText ? typed : 'Type something.'}
          </Text>
        </Box>
      </Box>
    )
  }

  // 单选：直接一行显示（更直观）
  return (
    <Box flexDirection="column">
      <Box>
        <Text>{prefix} </Text>
        <Text>{index}. </Text>
        <Text color={hasText ? theme.success : theme.secondaryText}>
          {typing ? `${typingValue}▏` : hasText ? typed : 'Type something.'}
        </Text>
      </Box>
    </Box>
  )
}

function findOther(selected: SelectedItem[]) {
  return selected.find((it) => it.type === 'other') as { type: 'other'; text: string } | undefined
}

function formatAnswerForSubmit(q: AskQuestion, s: QuestionState) {
  const parts: string[] = []
  for (const it of s.selected) {
    if (it.type === 'option') {
      const label = q.options[it.index]?.label
      if (label) parts.push(label)
    } else if (it.type === 'other') {
      if (it.text.trim()) parts.push(it.text.trim())
    }
  }
  // 提交给 handler 的 answers：建议干净字符串，不带尾逗号
  return q.multiSelect ? parts.join(', ') : (parts[0] ?? '')
}

function formatAnswerForDisplay(q: AskQuestion, s: QuestionState) {
  const base = formatAnswerForSubmit(q, s)
  // UI 展示：更接近你截图的“多选末尾逗号”
  return q.multiSelect && base ? `${base},` : base
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

function truncate(s: string, max: number) {
  const str = s || ''
  if (str.length <= max) return str
  return str.slice(0, max - 1) + '…'
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
```

---

## 3) 集成说明：和 `useReplController` / `REPL.tsx` 怎么配合

### ✅ 你 controller 不必改协议

你现有 handler 会 `await userInput.requestAnswers({ toolUseId: call.id, ... })`。
交互式 presenter 在用户点 “Submit answers” 时调用：

* `userInput.submitAnswers(toolUseId, answers)`（resolve Promise）
* 或 `userInput.reject(toolUseId, error)`（取消）

handler 继续返回 `JSON.stringify({ answers })`（协议不变）。

### ✅ REPL.tsx：必须“锁住主输入框”，否则会抢键盘

Ink 的输入是全局分发的，如果你还挂着主输入框（TextInput），方向键/Tab 很容易被它吞掉。

**最稳的做法：pendingAsk 存在时直接不渲染输入框。**

示例（伪代码，按你项目结构改名即可）：

```tsx
export function REPL(props) {
  const { state } = useReplController(...)

  return (
    <Box flexDirection="column">
      <MessagesList />

      {state.pendingAsk ? null : <YourReplTextInput />}

      {/* 如果你想留一行占位： */}
      {state.pendingAsk ? (
        <Box marginTop={1}>
          <Text color={theme.secondaryText}>Answer the questions above (Esc to cancel)</Text>
        </Box>
      ) : null}
    </Box>
  )
}
```

> 这一步基本就是“避免与主输入框冲突”的关键解法：**Ask UI 在 tool presenter 里接管键盘，REPL 输入框临时下线**。

---

## 4) 测试建议（关键交互场景）

建议用 `ink-testing-library`（或你现有 Ink 测试方式）覆盖这些场景：

1. **单选自动下一题**

   * ↓/Enter 选中某项 → 自动切到下一题 → Submit tab review 能看到答案

2. **多选 Space 切换**

   * Space 勾选 1、4 → Tab 到 Submit → Submit answers → 断言 `submitAnswers` 收到 `header -> 'A, B'`

3. **Type something 输入**

   * 按 `0` 或 `T` → 输入 `Submit` → Enter → other 变成选中并显示文本 → review 展示 `→ Submit`

4. **任意时刻 Esc 取消**

   * 断言 `reject(toolUseId, Error)` 被调用一次

5. **边界**

   * 只有 1 个问题（chips + submit 仍可切换）
   * header 为空（fallback 到 Q1/Q2）
   * options 数量是 0（你 spec 约束了 2-4，但防御性要兜底：此时 UI 只显示 Type something）

---

如果你把 `REPL.tsx`、`useReplController.ts`、以及 `userInputManager.ts` 也贴出来（哪怕是精简版），我可以把上面“入口 Provider 注入点”和“锁输入框的具体位置”改成**100% 对齐你项目真实代码的 diff 级修改**，直接复制就能跑。
