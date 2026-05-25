import { marked, type Tokens } from "marked";
import type {
  BlockquoteNode,
  CodexMarkdownNode,
  CodexMarkdownRootNode,
  HeadingNode,
  ListItemNode,
  ListNode,
  TableCellNode,
  TableNode,
} from "../types";
import { parseFileReference } from "./linkClassification";

type AnyToken = Tokens.Generic;

export const markedAdapter = {
  parse(source: string): CodexMarkdownRootNode {
    return {
      type: "root",
      children: parseSegments(source),
    };
  },
};

function parseSegments(source: string): CodexMarkdownNode[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const nodes: CodexMarkdownNode[] = [];
  const markdownBuffer: string[] = [];

  const flushMarkdown = () => {
    const markdown = markdownBuffer.join("\n").trim();
    markdownBuffer.length = 0;
    if (!markdown) {
      return;
    }
    const tokens = marked.lexer(markdown, { gfm: true });
    nodes.push(...normalizeBlockTokens(tokens as AnyToken[]));
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();

    if (isStandaloneHtmlContainerLine(trimmed)) {
      flushMarkdown();
      nodes.push({ type: "htmlLiteral", value: decodeHtmlEntities(trimmed), block: true });
      continue;
    }

    if (trimmed === "$$") {
      flushMarkdown();
      const body: string[] = [];
      index += 1;
      for (; index < lines.length; index += 1) {
        if ((lines[index] ?? "").trim() === "$$") {
          break;
        }
        body.push(lines[index] ?? "");
      }
      nodes.push({ type: "math", display: true, value: body.join("\n").trim() });
      continue;
    }

    markdownBuffer.push(line);
  }

  flushMarkdown();
  return nodes;
}

function isStandaloneHtmlContainerLine(value: string): boolean {
  return (
    value === "<details>" ||
    value === "</details>" ||
    /^<summary\b[^>]*>.*<\/summary>$/.test(value)
  );
}

function normalizeBlockTokens(tokens: AnyToken[]): CodexMarkdownNode[] {
  return tokens.flatMap((token): CodexMarkdownNode[] => {
    switch (token.type) {
      case "space":
        return [];
      case "heading":
        return [normalizeHeading(token as Tokens.Heading)];
      case "paragraph":
        return normalizeParagraph(token);
      case "text":
        return normalizeParagraph(token);
      case "blockquote":
        return [normalizeBlockquote(token as Tokens.Blockquote)];
      case "list":
        return [normalizeList(token as Tokens.List)];
      case "code":
        return [normalizeCodeBlock(token as Tokens.Code)];
      case "table":
        return [normalizeTable(token as Tokens.Table)];
      case "html":
        return [{ type: "htmlLiteral", value: decodeHtmlEntities(String(token.raw ?? token.text ?? "")) }];
      case "hr":
        return [{ type: "horizontalRule" }];
      default:
        return [{ type: "htmlLiteral", value: String(token.raw ?? "") }];
    }
  });
}

function normalizeParagraph(token: AnyToken): CodexMarkdownNode[] {
  const rawText = String(token.text ?? token.raw ?? "").trim();
  if (rawText.startsWith("$$") && rawText.endsWith("$$") && rawText.length > 4) {
    return [{ type: "math", display: true, value: rawText.slice(2, -2).trim() }];
  }
  return [{ type: "paragraph", children: normalizeInlineTokens(readInlineTokens(token)) }];
}

function normalizeHeading(token: Tokens.Heading): HeadingNode {
  return {
    type: "heading",
    depth: clampHeadingDepth(token.depth),
    children: normalizeInlineTokens(readInlineTokens(token)),
  };
}

function normalizeBlockquote(token: Tokens.Blockquote): BlockquoteNode {
  return {
    type: "blockquote",
    children: normalizeBlockTokens((token.tokens ?? []) as AnyToken[]),
  };
}

function normalizeList(token: Tokens.List): ListNode {
  return {
    type: "list",
    ordered: token.ordered,
    start: typeof token.start === "number" ? token.start : undefined,
    containsTaskList: token.items.some((item) => typeof item.checked === "boolean"),
    children: token.items.map(normalizeListItem),
  };
}

function normalizeListItem(item: Tokens.ListItem): ListItemNode {
  const children = normalizeBlockTokens((item.tokens ?? []) as AnyToken[]);
  return {
    type: "listItem",
    checked: typeof item.checked === "boolean" ? item.checked : undefined,
    children: flattenListItemParagraph(children),
  };
}

function normalizeCodeBlock(token: Tokens.Code): CodexMarkdownNode {
  const language = token.lang?.trim() || undefined;
  if (language?.toLowerCase() === "mermaid") {
    return {
      type: "mermaid",
      value: token.text,
    };
  }
  return {
    type: "codeBlock",
    value: token.text,
    language,
  };
}

function normalizeTable(token: Tokens.Table): TableNode {
  const align = token.align.map(normalizeAlign);
  return {
    type: "table",
    align,
    header: token.header.map((cell, index) => normalizeTableCell(cell, align[index], true)),
    rows: token.rows.map((row) => ({
      type: "tableRow",
      cells: row.map((cell, index) => normalizeTableCell(cell, align[index], false)),
    })),
  };
}

function normalizeTableCell(
  cell: Tokens.TableCell,
  align: "left" | "center" | "right" | null | undefined,
  header: boolean,
): TableCellNode {
  return {
    type: "tableCell",
    align,
    header,
    children: normalizeInlineTokens((cell.tokens ?? []) as AnyToken[]),
  };
}

function normalizeInlineTokens(tokens: AnyToken[]): CodexMarkdownNode[] {
  return tokens.flatMap((token): CodexMarkdownNode[] => {
    switch (token.type) {
      case "text":
      case "escape":
        return splitInlineText(String(token.text ?? token.raw ?? ""));
      case "strong":
        return [{ type: "strong", children: normalizeInlineTokens(readInlineTokens(token)) }];
      case "em":
        return [{ type: "emphasis", children: normalizeInlineTokens(readInlineTokens(token)) }];
      case "del":
        return [{ type: "delete", children: normalizeInlineTokens(readInlineTokens(token)) }];
      case "codespan":
        return [{ type: "inlineCode", value: decodeHtmlEntities(String(token.text ?? "")) }];
      case "link":
        return [normalizeLink(token as Tokens.Link)];
      case "image":
        return [
          {
            type: "image",
            src: String(token.href ?? ""),
            alt: String(token.text ?? ""),
            title: token.title ?? undefined,
          },
        ];
      case "html":
        return normalizeInlineHtml(String(token.raw ?? token.text ?? ""));
      case "br":
        return [{ type: "hardBreak" }];
      default:
        return [{ type: "text", value: String(token.raw ?? token.text ?? "") }];
    }
  });
}

function flattenListItemParagraph(children: CodexMarkdownNode[]): CodexMarkdownNode[] {
  if (children.length === 1 && children[0]?.type === "paragraph") {
    return children[0].children;
  }
  return children;
}

function splitInlineText(value: string): CodexMarkdownNode[] {
  const nodes: CodexMarkdownNode[] = [];
  let cursor = 0;

  while (cursor < value.length) {
    const start = findUnescapedDollar(value, cursor);

    if (start === -1) {
      pushTextWithHardBreaks(nodes, unescapeDollar(value.slice(cursor)));
      break;
    }

    const end = findUnescapedDollar(value, start + 1);
    if (end === -1) {
      pushTextWithHardBreaks(nodes, unescapeDollar(value.slice(cursor)));
      break;
    }

    pushTextWithHardBreaks(nodes, unescapeDollar(value.slice(cursor, start)));
    const math = value.slice(start + 1, end).trim();
    if (math) {
      nodes.push({ type: "math", display: false, value: math });
    } else {
      pushTextWithHardBreaks(nodes, "$$");
    }
    cursor = end + 1;
  }

  return nodes;
}

function normalizeInlineHtml(value: string): CodexMarkdownNode[] {
  if (/^<br\s*\/?>$/i.test(value.trim())) {
    return [{ type: "hardBreak" }];
  }
  return [{ type: "htmlLiteral", value: decodeHtmlEntities(value) }];
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#34;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

function findUnescapedDollar(value: string, start: number): number {
  for (let index = start; index < value.length; index += 1) {
    if (value[index] !== "$") {
      continue;
    }
    if (value[index - 1] === "\\" || value[index + 1] === "$" || value[index - 1] === "$") {
      continue;
    }
    return index;
  }
  return -1;
}

function pushText(nodes: CodexMarkdownNode[], value: string): void {
  if (value) {
    nodes.push({ type: "text", value });
  }
}

function pushTextWithHardBreaks(nodes: CodexMarkdownNode[], value: string): void {
  const parts = value.split("\n");
  parts.forEach((part, index) => {
    pushText(nodes, part);
    if (index < parts.length - 1) {
      nodes.push({ type: "hardBreak" });
    }
  });
}

function unescapeDollar(value: string): string {
  return value.replace(/\\\$/g, "$");
}

function normalizeLink(token: Tokens.Link): CodexMarkdownNode {
  if (isFootnoteFallbackLink(token)) {
    return { type: "text", value: String(token.text ?? "").trim() };
  }
  const label = plainText(readInlineTokens(token)) || token.text;
  const href = String(token.href ?? "");
  const reference = parseFileReference(href, label);
  if (reference != null) {
    return {
      type: "fileCitation",
      reference,
    };
  }
  return {
    type: "externalLink",
    href,
    title: token.title ?? undefined,
    children: normalizeInlineTokens(readInlineTokens(token)),
  };
}

function isFootnoteFallbackLink(token: Tokens.Link): boolean {
  const raw = String(token.raw ?? "").trim();
  const text = String(token.text ?? "").trim();
  return /^\[\^[^\]]+\]$/.test(raw) && /^\^[^\]]+$/.test(text);
}

function readInlineTokens(token: AnyToken): AnyToken[] {
  return Array.isArray(token.tokens) ? (token.tokens as AnyToken[]) : [];
}

function plainText(tokens: AnyToken[]): string {
  return tokens
    .map((token) => {
      if (typeof token.text === "string") {
        return token.text;
      }
      return readInlineTokens(token).length > 0 ? plainText(readInlineTokens(token)) : "";
    })
    .join("")
    .trim();
}

function normalizeAlign(value: string | null): "left" | "center" | "right" | null {
  return value === "left" || value === "center" || value === "right" ? value : null;
}

function clampHeadingDepth(depth: number): 1 | 2 | 3 | 4 | 5 | 6 {
  if (depth <= 1) return 1;
  if (depth >= 6) return 6;
  return depth as 1 | 2 | 3 | 4 | 5 | 6;
}
