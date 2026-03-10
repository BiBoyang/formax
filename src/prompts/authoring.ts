import type { PromptBlock, TextBlock } from './types'

export type PromptParagraphSpec = {
  kind: 'paragraph'
  text: string
}

export type PromptRawTextSpec = {
  kind: 'raw'
  text: string
}

export type PromptBulletListSpec = {
  kind: 'bullet_list'
  items: string[]
}

export type PromptSectionSpec = {
  kind: 'section'
  heading?: string
  children: PromptTextNode[]
}

export type PromptTextNode =
  | PromptParagraphSpec
  | PromptRawTextSpec
  | PromptBulletListSpec
  | PromptSectionSpec

export type PromptRenderable = string | PromptTextNode[]

export function paragraph(text: string): PromptParagraphSpec {
  return { kind: 'paragraph', text }
}

export function rawText(text: string): PromptRawTextSpec {
  return { kind: 'raw', text }
}

export function bulletList(items: string[]): PromptBulletListSpec {
  return { kind: 'bullet_list', items }
}

export function section(heading: string | undefined, children: PromptTextNode[]): PromptSectionSpec {
  return { kind: 'section', heading, children }
}

export function renderPromptText(nodes: PromptTextNode[], options?: { leadingBlankLine?: boolean }): string {
  const rendered = renderPromptNodes(nodes)
  const body = rendered.join('\n\n')
  if (!body) return ''
  return options?.leadingBlankLine ? `\n${body}` : body
}

export function renderSystemReminderText(
  content: PromptRenderable,
  options?: { trailingNewline?: boolean },
): string {
  const body = typeof content === 'string' ? normalizeBlockText(content) : renderPromptText(content)
  const wrapped = body ? `<system-reminder>\n${body}\n</system-reminder>` : '<system-reminder>\n</system-reminder>'
  return options?.trailingNewline ? `${wrapped}\n` : wrapped
}

export function makeEphemeralTextBlock(text: string): TextBlock {
  return {
    type: 'text',
    text,
    cache_control: { type: 'ephemeral' },
  }
}

export function makeSystemReminderBlock(
  content: PromptRenderable,
  options?: { trailingNewline?: boolean },
): PromptBlock {
  return makeEphemeralTextBlock(renderSystemReminderText(content, options))
}

function renderPromptNodes(nodes: PromptTextNode[]): string[] {
  return nodes
    .map((node) => renderPromptNode(node))
    .map((text) => text.trim().length > 0 ? text : '')
    .filter(Boolean)
}

function renderPromptNode(node: PromptTextNode): string {
  switch (node.kind) {
    case 'paragraph':
    case 'raw':
      return normalizeBlockText(node.text)
    case 'bullet_list':
      return node.items
        .map((item) => normalizeListItem(item))
        .filter(Boolean)
        .map((item) => `- ${item}`)
        .join('\n')
    case 'section': {
      const heading = normalizeBlockText(node.heading ?? '')
      const children = renderPromptNodes(node.children)
      if (!heading) return children.join('\n\n')
      if (children.length === 0) return ''
      return `${heading}\n${children.join('\n\n')}`
    }
  }
}

function normalizeBlockText(text: string): string {
  return String(text ?? '')
    .replace(/^\n+/, '')
    .replace(/\n+$/, '')
}

function normalizeListItem(item: string): string {
  return normalizeBlockText(item).trim()
}
