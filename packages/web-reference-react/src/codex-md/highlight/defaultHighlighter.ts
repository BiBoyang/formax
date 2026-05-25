import hljs from "highlight.js/lib/common";
import type { Highlighter } from "../types";

export const defaultHighlighter: Highlighter = (code, language) => {
  const normalizedLanguage = language?.trim().toLowerCase();
  if (normalizedLanguage && hljs.getLanguage(normalizedLanguage)) {
    const result = hljs.highlight(code, {
      language: normalizedLanguage,
      ignoreIllegals: true,
    });
    return {
      html: result.value,
      className: `hljs language-${normalizedLanguage}`,
    };
  }

  return {
    html: hljs.highlightAuto(code).value,
    className: "hljs",
  };
};
