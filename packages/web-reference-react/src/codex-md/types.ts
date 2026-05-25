import type { ComponentType, Key, MouseEvent, ReactNode } from "react";
import type { MermaidConfig } from "mermaid";

export type CodexMarkdownTheme = "light" | "dark" | "auto";

export type FileReference = {
  path: string;
  label?: string;
  line?: number;
  endLine?: number;
};

export type CodexMarkdownRootNode = {
  type: "root";
  children: CodexMarkdownNode[];
};

export type TextNode = {
  type: "text";
  value: string;
};

export type ParagraphNode = {
  type: "paragraph";
  children: CodexMarkdownNode[];
};

export type HeadingNode = {
  type: "heading";
  depth: 1 | 2 | 3 | 4 | 5 | 6;
  children: CodexMarkdownNode[];
};

export type EmphasisNode = {
  type: "emphasis";
  children: CodexMarkdownNode[];
};

export type StrongNode = {
  type: "strong";
  children: CodexMarkdownNode[];
};

export type DeleteNode = {
  type: "delete";
  children: CodexMarkdownNode[];
};

export type InlineCodeNode = {
  type: "inlineCode";
  value: string;
};

export type HardBreakNode = {
  type: "hardBreak";
};

export type CodeBlockNode = {
  type: "codeBlock";
  value: string;
  language?: string;
  meta?: string;
};

export type ExternalLinkNode = {
  type: "externalLink";
  href: string;
  title?: string;
  children: CodexMarkdownNode[];
};

export type FileCitationNode = {
  type: "fileCitation";
  reference: FileReference;
};

export type ListNode = {
  type: "list";
  ordered: boolean;
  start?: number;
  containsTaskList?: boolean;
  children: ListItemNode[];
};

export type ListItemNode = {
  type: "listItem";
  checked?: boolean;
  children: CodexMarkdownNode[];
};

export type BlockquoteNode = {
  type: "blockquote";
  children: CodexMarkdownNode[];
};

export type HorizontalRuleNode = {
  type: "horizontalRule";
};

export type FootnoteReferenceNode = {
  type: "footnoteReference";
  identifier: string;
};

export type FootnoteDefinitionNode = {
  type: "footnoteDefinition";
  identifier: string;
  children: CodexMarkdownNode[];
};

export type FootnotesNode = {
  type: "footnotes";
  children: FootnoteDefinitionNode[];
};

export type DefinitionListNode = {
  type: "definitionList";
  children: DefinitionListItemNode[];
};

export type DefinitionListItemNode = {
  type: "definitionListItem";
  term: CodexMarkdownNode[];
  definitions: CodexMarkdownNode[][];
};

export type AdmonitionKind = "note" | "tip" | "important" | "warning" | "caution" | string;

export type AdmonitionNode = {
  type: "admonition";
  kind: AdmonitionKind;
  title: string;
  children: CodexMarkdownNode[];
};

export type TableNode = {
  type: "table";
  align: Array<"left" | "center" | "right" | null>;
  header: TableCellNode[];
  rows: TableRowNode[];
};

export type TableRowNode = {
  type: "tableRow";
  cells: TableCellNode[];
};

export type TableCellNode = {
  type: "tableCell";
  align?: "left" | "center" | "right" | null;
  header?: boolean;
  children: CodexMarkdownNode[];
};

export type ImageNode = {
  type: "image";
  src: string;
  alt?: string;
  title?: string;
};

export type HtmlLiteralNode = {
  type: "htmlLiteral";
  value: string;
  block?: boolean;
};

export type MermaidNode = {
  type: "mermaid";
  value: string;
  meta?: string;
};

export type MathNode = {
  type: "math";
  value: string;
  display: boolean;
};

export type DetailsDirectiveNode = {
  type: "detailsDirective";
  summary?: string;
  open?: boolean;
  children: CodexMarkdownNode[];
};

export type CodexMarkdownNode =
  | TextNode
  | ParagraphNode
  | HeadingNode
  | EmphasisNode
  | StrongNode
  | DeleteNode
  | InlineCodeNode
  | HardBreakNode
  | CodeBlockNode
  | ExternalLinkNode
  | FileCitationNode
  | ListNode
  | ListItemNode
  | BlockquoteNode
  | HorizontalRuleNode
  | FootnoteReferenceNode
  | FootnoteDefinitionNode
  | FootnotesNode
  | DefinitionListNode
  | DefinitionListItemNode
  | AdmonitionNode
  | TableNode
  | TableRowNode
  | TableCellNode
  | ImageNode
  | HtmlLiteralNode
  | MermaidNode
  | MathNode
  | DetailsDirectiveNode;

export type ParseOptions = {
  cwd?: string;
};

export type MarkdownParserAdapter = {
  parse(source: string, options?: ParseOptions): CodexMarkdownRootNode;
};

export type HighlighterResult = {
  html: string;
  className?: string;
};

export type Highlighter = (
  code: string,
  language?: string,
) => HighlighterResult | null | Promise<HighlighterResult | null>;

export type NodeComponentProps<TNode extends CodexMarkdownNode = CodexMarkdownNode> = {
  node: TNode;
  children?: ReactNode;
  className?: string;
};

export type LinkComponentProps = NodeComponentProps<ExternalLinkNode> & {
  onExternalLinkClick?: CodexMarkdownProps["onExternalLinkClick"];
};

export type FileCitationComponentProps = NodeComponentProps<FileCitationNode> & {
  onOpenFile?: CodexMarkdownProps["onOpenFile"];
};

export type CodeBlockComponentProps = NodeComponentProps<CodeBlockNode | MermaidNode> & {
  highlighter?: Highlighter;
};

export type MermaidComponentProps = NodeComponentProps<MermaidNode> & {
  config?: MermaidConfig;
  theme?: CodexMarkdownTheme;
};

export type MathComponentProps = NodeComponentProps<MathNode> & {
  throwOnError?: boolean;
};

export type DefinitionListItemComponentProps = NodeComponentProps<DefinitionListItemNode> & {
  definitions: ReactNode[];
  term: ReactNode;
};

export type CodexMarkdownComponents = {
  paragraph: ComponentType<NodeComponentProps<ParagraphNode>>;
  heading: ComponentType<NodeComponentProps<HeadingNode>>;
  emphasis: ComponentType<NodeComponentProps<EmphasisNode>>;
  strong: ComponentType<NodeComponentProps<StrongNode>>;
  delete: ComponentType<NodeComponentProps<DeleteNode>>;
  inlineCode: ComponentType<NodeComponentProps<InlineCodeNode>>;
  codeBlock: ComponentType<CodeBlockComponentProps>;
  externalLink: ComponentType<LinkComponentProps>;
  fileCitation: ComponentType<FileCitationComponentProps>;
  list: ComponentType<NodeComponentProps<ListNode>>;
  listItem: ComponentType<NodeComponentProps<ListItemNode>>;
  blockquote: ComponentType<NodeComponentProps<BlockquoteNode>>;
  horizontalRule: ComponentType<NodeComponentProps<HorizontalRuleNode>>;
  footnoteReference: ComponentType<NodeComponentProps<FootnoteReferenceNode>>;
  footnotes: ComponentType<NodeComponentProps<FootnotesNode>>;
  footnoteDefinition: ComponentType<NodeComponentProps<FootnoteDefinitionNode>>;
  definitionList: ComponentType<NodeComponentProps<DefinitionListNode>>;
  definitionListItem: ComponentType<DefinitionListItemComponentProps>;
  admonition: ComponentType<NodeComponentProps<AdmonitionNode>>;
  table: ComponentType<NodeComponentProps<TableNode>>;
  tableRow: ComponentType<NodeComponentProps<TableRowNode>>;
  tableCell: ComponentType<NodeComponentProps<TableCellNode>>;
  image: ComponentType<NodeComponentProps<ImageNode>>;
  htmlLiteral: ComponentType<NodeComponentProps<HtmlLiteralNode>>;
  mermaid: ComponentType<MermaidComponentProps>;
  math: ComponentType<MathComponentProps>;
  details: ComponentType<NodeComponentProps<DetailsDirectiveNode>>;
};

export type MathOptions = {
  throwOnError?: boolean;
};

export type MermaidOptions = {
  config?: MermaidConfig;
};

export type CodexMarkdownProps = {
  value: string;
  cwd?: string;
  theme?: CodexMarkdownTheme;
  components?: Partial<CodexMarkdownComponents>;
  parser?: MarkdownParserAdapter;
  highlighter?: Highlighter;
  math?: MathOptions;
  mermaid?: MermaidOptions;
  onOpenFile?: (ref: FileReference) => void;
  onExternalLinkClick?: (href: string, event: MouseEvent<HTMLAnchorElement>) => void;
};

export type SharedMarkdownRenderProps = Omit<CodexMarkdownProps, "value">;

export type CodexMarkdownRootProps = {
  children?: ReactNode;
  theme?: CodexMarkdownTheme;
};

export type CodexMarkdownFragmentProps = SharedMarkdownRenderProps & {
  value: string;
};

export type CodexMessageMarkdownPart = {
  type: "markdown";
  key: Key;
  value: string;
  cwd?: string;
};

export type CodexMessageSlotPart = {
  type: "slot";
  key: Key;
  children: ReactNode;
  slotName?: string;
};

export type CodexMessageContentPart = CodexMessageMarkdownPart | CodexMessageSlotPart;

export type CodexMessageContentProps = Omit<SharedMarkdownRenderProps, "cwd"> & {
  parts: readonly CodexMessageContentPart[];
  cwd?: string;
};
