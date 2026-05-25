import { CodexMarkdownFragment } from "./CodexMarkdownFragment";
import { CodexMarkdownRoot } from "./CodexMarkdownRoot";
import type { CodexMessageContentProps } from "../types";

export function CodexMessageContent({
  parts,
  cwd,
  theme = "auto",
  components,
  parser,
  highlighter,
  math,
  mermaid,
  onExternalLinkClick,
  onOpenFile,
}: CodexMessageContentProps) {
  return (
    <CodexMarkdownRoot theme={theme}>
      {parts.map((part) => {
        if (part.type === "markdown") {
          return (
            <CodexMarkdownFragment
              components={components}
              cwd={part.cwd ?? cwd}
              highlighter={highlighter}
              key={part.key}
              math={math}
              mermaid={mermaid}
              onExternalLinkClick={onExternalLinkClick}
              onOpenFile={onOpenFile}
              parser={parser}
              theme={theme}
              value={part.value}
            />
          );
        }

        return (
          <div data-codex-message-part="slot" data-codex-message-slot={part.slotName} key={part.key}>
            {part.children}
          </div>
        );
      })}
    </CodexMarkdownRoot>
  );
}
