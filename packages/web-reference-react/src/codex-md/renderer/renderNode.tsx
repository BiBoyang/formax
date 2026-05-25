import type {
  CodexMarkdownComponents,
  CodexMarkdownNode,
  CodexMarkdownProps,
  CodexMarkdownRootNode,
} from "../types";

export type RenderContext = {
  components: CodexMarkdownComponents;
  highlighter: CodexMarkdownProps["highlighter"];
  math: CodexMarkdownProps["math"];
  mermaid: CodexMarkdownProps["mermaid"];
  onExternalLinkClick: CodexMarkdownProps["onExternalLinkClick"];
  onOpenFile: CodexMarkdownProps["onOpenFile"];
  theme: CodexMarkdownProps["theme"];
};

export function renderRoot(root: CodexMarkdownRootNode, context: RenderContext) {
  return root.children.map((node, index) => renderNode(node, context, `root-${index}`));
}

export function renderNode(node: CodexMarkdownNode, context: RenderContext, key: string): React.ReactNode {
  const { components } = context;

  switch (node.type) {
    case "text":
      return node.value;
    case "paragraph": {
      const Component = components.paragraph;
      return (
        <Component key={key} node={node}>
          {renderChildren(node.children, context, key)}
        </Component>
      );
    }
    case "heading": {
      const Component = components.heading;
      return (
        <Component key={key} node={node}>
          {renderChildren(node.children, context, key)}
        </Component>
      );
    }
    case "emphasis": {
      const Component = components.emphasis;
      return (
        <Component key={key} node={node}>
          {renderChildren(node.children, context, key)}
        </Component>
      );
    }
    case "strong": {
      const Component = components.strong;
      return (
        <Component key={key} node={node}>
          {renderChildren(node.children, context, key)}
        </Component>
      );
    }
    case "delete": {
      const Component = components.delete;
      return (
        <Component key={key} node={node}>
          {renderChildren(node.children, context, key)}
        </Component>
      );
    }
    case "inlineCode": {
      const Component = components.inlineCode;
      return <Component key={key} node={node} />;
    }
    case "hardBreak":
      return <br key={key} />;
    case "codeBlock": {
      const Component = components.codeBlock;
      return <Component highlighter={context.highlighter} key={key} node={node} />;
    }
    case "externalLink": {
      const Component = components.externalLink;
      return (
        <Component key={key} node={node} onExternalLinkClick={context.onExternalLinkClick}>
          {renderChildren(node.children, context, key)}
        </Component>
      );
    }
    case "fileCitation": {
      const Component = components.fileCitation;
      return <Component key={key} node={node} onOpenFile={context.onOpenFile} />;
    }
    case "list": {
      const Component = components.list;
      return (
        <Component key={key} node={node}>
          {node.children.map((child, index) => renderNode(child, context, `${key}-${index}`))}
        </Component>
      );
    }
    case "listItem": {
      const Component = components.listItem;
      return (
        <Component key={key} node={node}>
          {renderChildren(node.children, context, key)}
        </Component>
      );
    }
    case "blockquote": {
      const Component = components.blockquote;
      return (
        <Component key={key} node={node}>
          {renderChildren(node.children, context, key)}
        </Component>
      );
    }
    case "horizontalRule": {
      const Component = components.horizontalRule;
      return <Component key={key} node={node} />;
    }
    case "footnoteReference": {
      const Component = components.footnoteReference;
      return <Component key={key} node={node} />;
    }
    case "footnotes": {
      const Component = components.footnotes;
      return (
        <Component key={key} node={node}>
          {node.children.map((child, index) => renderNode(child, context, `${key}-${index}`))}
        </Component>
      );
    }
    case "footnoteDefinition": {
      const Component = components.footnoteDefinition;
      return (
        <Component key={key} node={node}>
          {renderChildren(node.children, context, key)}
        </Component>
      );
    }
    case "definitionList": {
      const Component = components.definitionList;
      return (
        <Component key={key} node={node}>
          {node.children.map((child, index) => renderNode(child, context, `${key}-${index}`))}
        </Component>
      );
    }
    case "definitionListItem": {
      const Component = components.definitionListItem;
      return (
        <Component
          definitions={node.definitions.map((definition, index) => renderChildren(definition, context, `${key}-def-${index}`))}
          key={key}
          node={node}
          term={renderChildren(node.term, context, `${key}-term`)}
        />
      );
    }
    case "admonition": {
      const Component = components.admonition;
      return (
        <Component key={key} node={node}>
          {renderChildren(node.children, context, key)}
        </Component>
      );
    }
    case "table": {
      const Component = components.table;
      return (
        <Component key={key} node={node}>
          <thead className="codex-md-table-head">
            <tr className="codex-md-table-row border-b border-token-border last:border-b-0">
              {node.header.map((cell, index) => renderNode(cell, context, `${key}-head-${index}`))}
            </tr>
          </thead>
          <tbody>{node.rows.map((row, index) => renderNode(row, context, `${key}-row-${index}`))}</tbody>
        </Component>
      );
    }
    case "tableRow": {
      const Component = components.tableRow;
      return (
        <Component key={key} node={node}>
          {node.cells.map((cell, index) => renderNode(cell, context, `${key}-${index}`))}
        </Component>
      );
    }
    case "tableCell": {
      const Component = components.tableCell;
      return (
        <Component key={key} node={node}>
          {renderChildren(node.children, context, key)}
        </Component>
      );
    }
    case "image": {
      const Component = components.image;
      return <Component key={key} node={node} />;
    }
    case "htmlLiteral": {
      const Component = components.htmlLiteral;
      return <Component key={key} node={node} />;
    }
    case "mermaid": {
      const Component = components.mermaid;
      return <Component config={context.mermaid?.config} key={key} node={node} theme={context.theme} />;
    }
    case "math": {
      const Component = components.math;
      return <Component key={key} node={node} throwOnError={context.math?.throwOnError} />;
    }
    case "detailsDirective": {
      const Component = components.details;
      return (
        <Component key={key} node={node}>
          {renderChildren(node.children, context, key)}
        </Component>
      );
    }
  }
}

function renderChildren(children: CodexMarkdownNode[], context: RenderContext, keyPrefix: string) {
  return children.map((child, index) => renderNode(child, context, `${keyPrefix}-${index}`));
}
