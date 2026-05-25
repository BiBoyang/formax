export const MARKDOWN_ROOT_SEMANTIC_CLASS_NAME = "codex-md codex-md-markdown-content";
export const MARKDOWN_ROOT_EVIDENCE_CLASS_NAME = "_markdownRoot_x0d1c_80 _markdownContent_x0d1c_43";
export const MARKDOWN_ROOT_UTILITY_CLASS_NAME =
  "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&>ol:first-child]:mt-0 [&>ul:first-child]:mt-0";
export const MARKDOWN_ROOT_CLASS_NAME = `${MARKDOWN_ROOT_SEMANTIC_CLASS_NAME} ${MARKDOWN_ROOT_UTILITY_CLASS_NAME} ${MARKDOWN_ROOT_EVIDENCE_CLASS_NAME}`;

export const INLINE_MARKDOWN_SEMANTIC_CLASS_NAME = "codex-md-inline-code";
export const INLINE_MARKDOWN_EVIDENCE_CLASS_NAME = "_inlineMarkdown_x0d1c_75 inline-markdown";
export const INLINE_MARKDOWN_UTILITY_CLASS_NAME =
  "text-size-chat-sm font-mono blend bg-token-text-code-block-background rounded-sm px-1.5 py-0.5 leading-none extension:bg-token-foreground/10 electron:bg-token-list-hover-background/60";
export const INLINE_MARKDOWN_CLASS_NAME = `${INLINE_MARKDOWN_SEMANTIC_CLASS_NAME} ${INLINE_MARKDOWN_EVIDENCE_CLASS_NAME} ${INLINE_MARKDOWN_UTILITY_CLASS_NAME}`;
export const HTML_LITERAL_CLASS_NAME = `${INLINE_MARKDOWN_CLASS_NAME} codex-md-html-literal`;

export const HEADING_SEMANTIC_CLASS_NAME = "codex-md-heading codex-md-heading-inline-code";
export const HEADING_EVIDENCE_CLASS_NAME = "_headingInlineCode_x0d1c_75";
export const HEADING_SHARED_UTILITY_CLASS_NAME = "font-semibold";
export const HEADING_DEPTH_CLASS_NAMES: Record<1 | 2 | 3 | 4 | 5 | 6, string> = {
  1: "codex-md-heading-1 heading-lg mt-5 mb-2",
  2: "codex-md-heading-2 heading-base mt-4 mb-2",
  3: "codex-md-heading-3 heading-subsection mt-3 mb-1.5",
  4: "codex-md-heading-4",
  5: "codex-md-heading-5",
  6: "codex-md-heading-6",
};

export function headingClassName(depth: 1 | 2 | 3 | 4 | 5 | 6): string {
  return `${HEADING_SEMANTIC_CLASS_NAME} ${HEADING_SHARED_UTILITY_CLASS_NAME} ${HEADING_EVIDENCE_CLASS_NAME} ${HEADING_DEPTH_CLASS_NAMES[depth]}`;
}

export const TABLE_CELL_FILE_LINK_SEMANTIC_CLASS_NAME = "codex-md-table-cell-file-link";
export const TABLE_CELL_FILE_LINK_EVIDENCE_CLASS_NAME = "_tableCellFileLink_x0d1c_53";
export const TABLE_CELL_FILE_LINK_CLASS_NAME = `${TABLE_CELL_FILE_LINK_SEMANTIC_CLASS_NAME} ${TABLE_CELL_FILE_LINK_EVIDENCE_CLASS_NAME}`;

export const WIDE_BLOCK_SEMANTIC_CLASS_NAME = "codex-md-wide-block codex-md-mermaid";
export const WIDE_BLOCK_EVIDENCE_CLASS_NAME = "_wideBlock_x0d1c_19";
export const WIDE_BLOCK_CLASS_NAME = `${WIDE_BLOCK_SEMANTIC_CLASS_NAME} ${WIDE_BLOCK_EVIDENCE_CLASS_NAME}`;
export const IMAGE_ENTER_EVIDENCE_CLASS_NAME = "_imageEnter_x0d1c_90";

export const PARAGRAPH_CLASS_NAME =
  "codex-md-paragraph text-size-chat leading-[calc(var(--codex-chat-font-size)+8px)] extension:leading-normal my-2";
export const TEXT_SIZE_CHAT_CLASS_NAME =
  "text-size-chat leading-[calc(var(--codex-chat-font-size)+8px)] extension:leading-normal";

export const IMAGE_ELEMENT_STYLE = {
  borderRadius: "var(--radius-2xs, 0.125rem)",
  display: "block",
  height: "100%",
  maxHeight: "inherit",
  maxWidth: "100%",
  objectFit: "contain",
  width: "100%",
} as const;
