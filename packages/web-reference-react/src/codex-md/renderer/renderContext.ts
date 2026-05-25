import { useMemo } from "react";
import { defaultComponents } from "../components/defaultComponents";
import { defaultHighlighter } from "../highlight";
import type { CodexMarkdownComponents, SharedMarkdownRenderProps } from "../types";
import type { RenderContext } from "./renderNode";

export function useRenderContext({
  components,
  highlighter = defaultHighlighter,
  math,
  mermaid,
  onExternalLinkClick,
  onOpenFile,
  theme = "auto",
}: SharedMarkdownRenderProps): RenderContext {
  const mergedComponents = useMemo<CodexMarkdownComponents>(
    () => ({ ...defaultComponents, ...components }),
    [components],
  );

  return useMemo(
    () => ({
      components: mergedComponents,
      highlighter,
      math,
      mermaid,
      onExternalLinkClick,
      onOpenFile,
      theme,
    }),
    [highlighter, math, mergedComponents, mermaid, onExternalLinkClick, onOpenFile, theme],
  );
}
