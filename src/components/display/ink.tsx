/**
 * Ink 库的所有导出组件和工具
 * 这个文件重新导出 ink 库中的所有公开 API
 */

// 直接重新导出所有内容
export {
  render,
  Box,
  Text,
  Static,
  Transform,
  Newline,
  Spacer,
  useInput,
  useApp,
  useStdin,
  useStdout,
  useStderr,
  useFocus,
  useFocusManager,
  measureElement,
} from 'ink';

export type {
  RenderOptions,
  Instance,
  BoxProps,
  TextProps,
  StaticProps,
  TransformProps,
  NewlineProps,
  AppProps,
  StdinProps,
  StdoutProps,
  StderrProps,
  Key,
  DOMElement,
} from 'ink';

