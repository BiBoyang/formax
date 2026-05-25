import { useMemo } from "react";
import { markedAdapter } from "../parser/markedAdapter";
import type { CodexMarkdownFragmentProps } from "../types";
import { useRenderContext } from "./renderContext";
import { renderRoot } from "./renderNode";

export function CodexMarkdownFragment({
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
}: CodexMarkdownFragmentProps) {
  const root = useMemo(() => parser.parse(value, { cwd }), [cwd, parser, value]);
  const context = useRenderContext({
    components,
    highlighter,
    math,
    mermaid,
    onExternalLinkClick,
    onOpenFile,
    theme,
  });

  return <>{renderRoot(root, context)}</>;
}
