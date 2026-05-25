import { MARKDOWN_ROOT_CLASS_NAME } from "../classNames";
import type { CodexMarkdownRootProps } from "../types";

export function CodexMarkdownRoot({ children, theme = "auto" }: CodexMarkdownRootProps) {
  return (
    <div className={MARKDOWN_ROOT_CLASS_NAME} data-selected-text-overlay-target="codex-md" data-theme={theme}>
      {children}
    </div>
  );
}
