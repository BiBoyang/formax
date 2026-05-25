import type { CodexMarkdownComponents } from "../types";
import { linksMediaComponents } from "./linksMedia";
import { runtimeBlockComponents } from "./runtimeBlocks";
import { textStructureComponents } from "./textStructure";

export const defaultComponents: CodexMarkdownComponents = {
  ...textStructureComponents,
  ...linksMediaComponents,
  ...runtimeBlockComponents,
};
