import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import { getTheme } from '../../utils/theme.js'
import {
  AddHookView,
  AddMatcherView,
  ConfirmDeleteView,
  EventListView,
  FooterHint,
  HookListView,
  MatcherListView,
  SaveHookView,
  formatSaveScopeLabel,
} from './ui.js'

describe('ui/hooks/ui', () => {
  const theme = getTheme()
  const inputScope = 'hooks-dialog' as any

  it('renders shared footer hint', () => {
    const out = render(<FooterHint theme={theme} text="hint" />).lastFrame() || ''
    expect(out).toContain('hint')
  })

  it('renders event list with arrows and banner', () => {
    const events = Array.from({ length: 8 }, (_, i) => ({
      id: `ev-${i + 1}`,
      label: `Event ${i + 1}`,
      enabled: i % 2 === 0,
    }))
    const topFrame = render(<EventListView theme={theme} events={events} cursor={0} banner="saved" />).lastFrame() || ''
    expect(topFrame).toContain('Hook Configuration')
    expect(topFrame).toContain('saved')
    expect(topFrame).toContain('↓')

    const lowerFrame = render(<EventListView theme={theme} events={events} cursor={6} />).lastFrame() || ''
    expect(lowerFrame).toContain('↑')
  })

  it('renders matcher list and add row', () => {
    const matchers = [
      { source: 'projectLocal' as const, matcher: 'Bash(ls:*)', hooksCount: 2 },
      { source: 'project' as const, matcher: '*', hooksCount: 1 },
      { source: 'other' as any, matcher: 'Web.*', hooksCount: 3 },
      { source: 'user' as const, matcher: 'Read', hooksCount: 1 },
      { source: 'project' as const, matcher: 'Write', hooksCount: 1 },
      { source: 'projectLocal' as const, matcher: 'Edit', hooksCount: 1 },
    ]
    const out = render(
      <MatcherListView theme={theme} eventName="PreToolUse" matchers={matchers} cursor={1} banner="b" />,
    ).lastFrame() || ''
    expect(out).toContain('PreToolUse - Tool Matchers')
    expect(out).toContain('+ Add new matcher')
    expect(out).toContain('[Local] Bash(ls:*)')
    expect(out).toContain('2 hooks')
    expect(out).toContain('[Settings] Web.*')
    expect(out).toContain('↓')

    const noBanner = render(
      <MatcherListView theme={theme} eventName="PreToolUse" matchers={matchers} cursor={0} />,
    ).lastFrame() || ''
    expect(noBanner).toContain('+ Add new matcher')

    const scrolled = render(
      <MatcherListView theme={theme} eventName="PreToolUse" matchers={matchers} cursor={5} />,
    ).lastFrame() || ''
    expect(scrolled).toContain('↑')
  })

  it('renders hook list for empty and non-empty cases', () => {
    const empty = render(
      <HookListView theme={theme} eventName="PreToolUse" matcher="*" hooks={[]} cursor={0} />,
    ).lastFrame() || ''
    expect(empty).toContain('+ Add new hook')
    expect(empty).toContain('No hooks configured yet')

    const hooks = [
      { source: 'user', matcher: '*', command: 'echo 1', timeoutMs: null },
      { source: 'project', matcher: '*', command: 'echo 2', timeoutMs: null },
      { source: 'projectLocal', matcher: '*', command: 'echo 3', timeoutMs: null },
      { source: 'user', matcher: '*', command: 'echo 4', timeoutMs: null },
      { source: 'project', matcher: '*', command: 'echo 5', timeoutMs: null },
      { source: 'project', matcher: '*', command: 'echo 6', timeoutMs: null },
    ] as any
    const listed = render(
      <HookListView theme={theme} eventName="PostToolUse" matcher="*" hooks={hooks} cursor={2} showMatcher={false} />,
    ).lastFrame() || ''
    expect(listed).toContain('PostToolUse')
    expect(listed).toContain('echo 2')
    expect(listed).toContain('Project Settings')
    expect(listed).toContain('↓')

    const scrolled = render(
      <HookListView
        theme={theme}
        eventName="PostToolUse"
        matcher="*"
        hooks={hooks}
        cursor={5}
        banner="saved"
      />,
    ).lastFrame() || ''
    expect(scrolled).toContain('saved')
    expect(scrolled).toContain('↑')
  })

  it('renders matcher/hook add forms and submit handlers are wired', () => {
    const onChange = vi.fn()
    const onSubmit = vi.fn()

    const matcher = render(
      <AddMatcherView
        theme={theme}
        eventName="Stop"
        inputText="Write"
        matcherValues="Write,Edit"
        inputScope={inputScope}
        onChange={onChange}
        onSubmit={onSubmit}
      />,
    ).lastFrame() || ''
    expect(matcher).toContain('Add new matcher for Stop')
    expect(matcher).toContain('Possible matcher values')

    const hook = render(
      <AddHookView
        theme={theme}
        eventName="PreToolUse"
        matcherName="Bash(ls:*)"
        showMatcher={false}
        inputText="echo hi"
        inputScope={inputScope}
        onChange={onChange}
        onSubmit={onSubmit}
      />,
    ).lastFrame() || ''
    expect(hook).toContain('Add new hook')
    expect(hook).toContain('Event: PreToolUse')
    expect(hook).toContain('Before tool execution')
    expect(hook).toContain('Examples:')

    const unknownEvent = render(
      <AddHookView
        theme={theme}
        eventName="UnknownEvent"
        matcherName="*"
        showMatcher={true}
        inputText="echo hi"
        inputScope={inputScope}
        onChange={onChange}
        onSubmit={onSubmit}
      />,
    ).lastFrame() || ''
    expect(unknownEvent).toContain('Event: UnknownEvent')
    expect(unknownEvent).toContain('Matcher: *')
  })

  it('renders save/delete views and scope label helper', () => {
    const save = render(
      <SaveHookView
        theme={theme}
        eventName="PreToolUse"
        matcherName="*"
        showMatcher={true}
        hookCommand="echo ok"
        cursor={1}
      />,
    ).lastFrame() || ''
    expect(save).toContain('Save hook configuration')
    expect(save).toContain('echo ok')

    const saveNoMatcher = render(
      <SaveHookView
        theme={theme}
        eventName="Stop"
        matcherName="*"
        showMatcher={false}
        hookCommand="echo no"
        cursor={0}
      />,
    ).lastFrame() || ''
    expect(saveNoMatcher).toContain('Event: Stop')
    expect(saveNoMatcher).not.toContain('Matcher:')

    const del = render(
      <ConfirmDeleteView
        theme={theme}
        command="rm -rf /tmp/x"
        eventName="PreToolUse"
        matcherName="*"
        source={'unknown' as any}
        cursor={1}
        showMatcher={false}
      />,
    ).lastFrame() || ''
    expect(del).toContain('Delete hook?')
    expect(del).toContain('Settings')
    expect(del).toContain('2. No')

    const projectDel = render(
      <ConfirmDeleteView
        theme={theme}
        command="echo"
        eventName="Stop"
        matcherName="*"
        source={'project'}
        cursor={0}
      />,
    ).lastFrame() || ''
    expect(projectDel).toContain('Project settings (.formax/settings.json)')

    const userDel = render(
      <ConfirmDeleteView
        theme={theme}
        command="echo"
        eventName="Stop"
        matcherName="*"
        source={'user'}
        cursor={0}
      />,
    ).lastFrame() || ''
    expect(userDel).toContain('User settings (~/.formax/settings.json)')

    const localDel = render(
      <ConfirmDeleteView
        theme={theme}
        command="echo"
        eventName="Stop"
        matcherName="*"
        source={'projectLocal'}
        cursor={0}
      />,
    ).lastFrame() || ''
    expect(localDel).toContain('Local settings (.formax/settings.local.json)')

    expect(formatSaveScopeLabel('user')).toContain('settings')
    expect(formatSaveScopeLabel('unknown' as any)).toBe('unknown')
  })

  it('handles window-top edge cursors in event list helper flow', () => {
    const events = Array.from({ length: 3 }, (_, i) => ({
      id: `e${i}`,
      label: `Event ${i}`,
      enabled: true,
    }))

    const negative = render(<EventListView theme={theme} events={events} cursor={-1} />).lastFrame() || ''
    expect(negative).toContain('Event 0')

    const huge = render(<EventListView theme={theme} events={events} cursor={99} />).lastFrame() || ''
    expect(huge).toContain('Event 2')
  })
})
