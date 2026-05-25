import type { CodexMarkdownProps } from "../types";
import { markedAdapter } from "../parser/markedAdapter";
import { CodexMarkdownFragment } from "./CodexMarkdownFragment";
import { CodexMarkdownRoot } from "./CodexMarkdownRoot";

export function CodexMarkdown({
  value,
  cwd,
  theme = "auto",
  components,
  parser = markedAdapter,
  highlighter,
  math,
  mermaid,
  onExternalLinkClick,
  onOpenFile,
}: CodexMarkdownProps) {
  return (
    <CodexMarkdownRoot theme={theme}>
      <CodexMarkdownFragment
        components={components}
        cwd={cwd}
        highlighter={highlighter}
        math={math}
        mermaid={mermaid}
        onExternalLinkClick={onExternalLinkClick}
        onOpenFile={onOpenFile}
        parser={parser}
        theme={theme}
        value={value}
      />
    </CodexMarkdownRoot>
  );
}
