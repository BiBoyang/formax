import type {
  CodexMarkdownComponents,
  DefinitionListItemComponentProps,
  NodeComponentProps,
} from "../types";
import {
  headingClassName,
  INLINE_MARKDOWN_CLASS_NAME,
  PARAGRAPH_CLASS_NAME,
  TEXT_SIZE_CHAT_CLASS_NAME,
} from "../classNames";

export const textStructureComponents: Pick<
  CodexMarkdownComponents,
  | "paragraph"
  | "heading"
  | "emphasis"
  | "strong"
  | "delete"
  | "inlineCode"
  | "list"
  | "listItem"
  | "blockquote"
  | "horizontalRule"
  | "footnoteReference"
  | "footnotes"
  | "footnoteDefinition"
  | "definitionList"
  | "definitionListItem"
  | "admonition"
  | "table"
  | "tableRow"
  | "tableCell"
  | "details"
> = {
  paragraph({ children }) {
    return <p className={PARAGRAPH_CLASS_NAME}>{children}</p>;
  },

  heading({ node, children }) {
    const Tag = `h${node.depth}` as const;
    return <Tag className={headingClassName(node.depth)}>{children}</Tag>;
  },

  emphasis({ children }) {
    return <em>{children}</em>;
  },

  strong({ children }) {
    return <strong className="codex-md-strong font-semibold">{children}</strong>;
  },

  delete({ children }) {
    return <del>{children}</del>;
  },

  inlineCode({ node }) {
    return <span className={INLINE_MARKDOWN_CLASS_NAME}>{node.value}</span>;
  },

  list({ node, children }) {
    const Tag = node.ordered ? "ol" : "ul";
    const className = [
      "codex-md-list",
      TEXT_SIZE_CHAT_CLASS_NAME,
      node.ordered ? "codex-md-list-ordered" : "codex-md-list-unordered",
      node.ordered ? "list-decimal mt-1.5 mb-3 pl-8" : null,
      !node.ordered && node.containsTaskList ? "mt-0 mb-4 list-none pl-0 contains-task-list" : null,
      !node.ordered && !node.containsTaskList ? "mt-0 mb-4 list-disc pl-4" : null,
      node.containsTaskList ? "codex-md-contains-task-list" : null,
    ]
      .filter(Boolean)
      .join(" ");
    return (
      <Tag className={className} start={node.start}>
        {children}
      </Tag>
    );
  },

  listItem({ node, children }) {
    const hasTaskState = typeof node.checked === "boolean";
    return (
      <li
        className={
          hasTaskState
            ? `${TEXT_SIZE_CHAT_CLASS_NAME} codex-md-list-item codex-md-task-list-item mb-1.5 list-none task-list-item`
            : `${TEXT_SIZE_CHAT_CLASS_NAME} codex-md-list-item mb-1.5`
        }
      >
        {hasTaskState ? <input aria-label="Task item" checked={node.checked} disabled type="checkbox" /> : null}
        {children}
      </li>
    );
  },

  blockquote({ children }) {
    return <blockquote className={`${TEXT_SIZE_CHAT_CLASS_NAME} codex-md-blockquote my-3 border-l-2 border-token-border pl-4 italic`}>{children}</blockquote>;
  },

  horizontalRule() {
    return <hr className="codex-md-hr my-4 border-t border-token-border" />;
  },

  footnoteReference({ node }) {
    return <span className={INLINE_MARKDOWN_CLASS_NAME}>{`[^${node.identifier}]`}</span>;
  },

  footnotes({ children }) {
    return <>{children}</>;
  },

  footnoteDefinition({ node, children }) {
    return (
      <p className={PARAGRAPH_CLASS_NAME}>
        <span className={INLINE_MARKDOWN_CLASS_NAME}>{`[^${node.identifier}]:`}</span> {children}
      </p>
    );
  },

  definitionList({ children }) {
    return <div className="codex-md-definition-list">{children}</div>;
  },

  definitionListItem(props) {
    return <DefinitionListItemContent {...props} />;
  },

  admonition({ node, children }) {
    return (
      <blockquote className={`codex-md-blockquote ${TEXT_SIZE_CHAT_CLASS_NAME} codex-md-admonition codex-md-admonition-${node.kind} my-3 border-l-2 border-token-border pl-4 italic`}>
        <p className={PARAGRAPH_CLASS_NAME}>{`[!${node.kind.toUpperCase()}] ${node.title}`}</p>
        {children}
      </blockquote>
    );
  },

  table({ children }) {
    return (
      <div className="codex-md-table-wrap my-4 overflow-x-auto overflow-y-hidden">
        <table className={`${TEXT_SIZE_CHAT_CLASS_NAME} codex-md-table w-full table-auto border-collapse`}>{children}</table>
      </div>
    );
  },

  tableRow({ children }) {
    return <tr className="codex-md-table-row border-b border-token-border last:border-b-0">{children}</tr>;
  },

  tableCell({ node, children }) {
    const Tag = node.header ? "th" : "td";
    const className = node.header
      ? "codex-md-table-cell max-w-48 min-w-16 p-1 text-left align-top font-semibold whitespace-normal text-token-foreground"
      : "codex-md-table-cell max-w-48 min-w-16 p-1 align-top whitespace-normal";
    return <Tag className={className}>{children}</Tag>;
  },

  details({ node, children }) {
    return (
      <p className={PARAGRAPH_CLASS_NAME}>
        <span className={INLINE_MARKDOWN_CLASS_NAME}>{`:::details${node.summary ? ` summary="${node.summary}"` : ""}${node.open ? " open=true" : ""}`}</span>
        <br />
        {children}
        <br />
        <span className={INLINE_MARKDOWN_CLASS_NAME}>:::</span>
      </p>
    );
  },
};

function DefinitionListItemContent({ term, definitions }: DefinitionListItemComponentProps) {
  return (
    <p className={PARAGRAPH_CLASS_NAME}>
      {term}
      {definitions.map((definition, index) => (
        <span key={index}>
          <br />: {definition}
        </span>
      ))}
    </p>
  );
}

export function Text({ node }: NodeComponentProps<{ type: "text"; value: string }>) {
  return <>{node.value}</>;
}
