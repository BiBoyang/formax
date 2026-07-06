# Web `@pierre/diffs` Word-Diff Renderer Crash

最后更新：2026-07-06

## Problem

在 Web/Electron 右侧 Review diff 中，点击某个 Markdown 文件的 file header 后，页面会短暂显示 loading，然后 Electron renderer 进程崩溃，DevTools 显示 disconnected。React error boundary 没有捕获到异常。

这类现象容易被误判成：

- Markdown 文件不能用 `@pierre/diffs` 渲染
- lazy patch loading 有问题
- 文件数量太多导致整页 diff 一次性加载
- React state/toggle 写错导致崩溃

实际触发条件不是 Markdown 本身，而是默认强制开启行内词级差异渲染。底层把 Electron renderer 进程打崩的 native fault 需要 Crashpad/minidump 才能 100% 定性；现有证据只能证明它稳定来自 `@pierre/diffs` 的 word-level inline diff 渲染路径，而不是 patch 加载、React state、或输入过大。

## Repro Shape

触发条件更接近下面这个组合：

- Electron renderer 环境
- `@pierre/diffs` 渲染修改型文本文件
- patch 中有成对的 deletion/addition 行
- `lineDiffType` 被强制设为 `word`

例如一个 Markdown 文件只改动一行，也可能触发：旧行被删除，新行被添加，diff renderer 会把这两行配对并计算词级差异。

反例也很重要：一个 untracked/new Markdown 文件可能不会崩。因为新文件通常只有 additions，没有 deletion/addition 成对行，不会进入同一条词级差异计算路径。

## Root Cause

`@pierre/diffs` 的大致渲染链路是：

1. `parsePatchFiles(...)` 把 git patch 解析成 file diff metadata。
2. 渲染 changed hunk 时，库会把 deletion line 和 addition line 配对。
3. 如果 `lineDiffType !== 'none'`，且 deletion/addition 都存在，就会进一步计算行内差异。
4. `lineDiffType: 'word'` 会走 word-level diff 计算，然后生成 span decorations。
5. 后续再交给 highlighter / DOM renderer 生成最终 diff UI。

在 `@pierre/diffs@1.2.5` 中，这条关键分支在 `computeLineDiffDecorations(...)` 附近：

```ts
if (deletionLine == null || additionLine == null || lineDiffType === 'none') return
if (deletionLine.length > maxLineDiffLength || additionLine.length > maxLineDiffLength) return
const lineDiff = lineDiffType === 'char'
  ? diffChars(deletionLine, additionLine)
  : diffWordsWithSpace(deletionLine, additionLine)
```

也就是说：

- new/untracked file 通常只有 addition，没有 deletion，第一行 guard 会 return。
- `lineDiffType: 'none'` 会在同一个 guard 直接 return。
- 修改型文件的 deletion/addition pair 且 `lineDiffType: 'word'` 会进入 `diffWordsWithSpace(...)` + decoration 生成路径。

这次 crash 发生在“已拿到 patch、`@pierre/diffs` 已经完成 post-render 附近”之后，Electron 主进程记录到 renderer `render-process-gone`，reason 为 `crashed`。这说明它不是普通 JS exception，也不是 React error boundary 能兜住的错误，而是 Chromium/Electron renderer 进程级崩溃。

这也说明它不像是“内存占用太多”导致的 OOM：触发 crash 的 `CODEMAP.md` patch 只有约 1.2 KB、13 行、1 addition、1 deletion。输入非常小，且崩溃发生在 post-render 后数百毫秒，更符合 Chromium/Electron native renderer fault 或库渲染路径触发浏览器内部 bug 的画像。

换句话说，问题不是“Markdown 被当成 Markdown 渲染了”。我们没有把 `# heading` 渲染成富文本标题；它仍然只是原始文本 diff。问题在于 word-level inline diff 对某些文本 patch shape 触发了 `@pierre/diffs@1.2.5` + Electron renderer 的不稳定路径。没有 crash dump 时，不要把这进一步表述成“已证明是某个具体 Chromium 内存越界/DOM bug”。

## Why Codex App Did Not Crash

Codex App 也使用 `@pierre/diffs`，但它的集成方式不同：

- Codex App 使用的版本更新，本地包说明中可见 `@pierre/diffs 1.3.0-beta.4`。
- Codex 的封装默认不强制开启 word diff。
- 它有类似 `wordDiffsEnabled` 的设置，默认关闭。
- 当单文件变更量超过阈值时，Codex 也会把 `lineDiffType` 降为 `none`。

因此“Codex 可以渲染 Markdown”不能推出“我们强制 `lineDiffType: 'word'` 也安全”。真正的差异是默认策略和保护阈值，而不是文件扩展名。

## Fix

默认不要强制开启 word-level line diff。

当前安全策略：

- Markdown / MDX / Mermaid 等文档类文件仍然走 `@pierre/diffs`。
- 对这些文件只使用 `setLanguageOverride(fileDiff, 'text')`，让它按 plain text 语法高亮。
- 默认 `lineDiffType` 使用 `none`，不做行内词级差异。

如果未来要恢复“文字差异”功能，必须做成显式开关，并加保护：

- 默认关闭。
- 只在单文件变更量较小时启用。
- 优先使用 Codex 风格的 `word-alt` 而不是手写 `word`。
- 对大文件、文档类文件、完整文件加载模式保持降级到 `none`。
- 必须用 Electron 手动 smoke 验证，而不能只依赖 Vitest。

## Debugging Notes

遇到类似问题时，先区分两类错误：

- React/JS 错误：console 有 stack，error boundary 可能捕获，页面一般不直接白屏断开。
- Renderer native crash：DevTools disconnected，主进程可记录 `render-process-gone`，React 无法捕获。

如果是后者，优先检查：

- 是否启用了行内词级 diff。
- 是否 mounted 太多 diff renderer。
- 是否给 renderer 传入了完整文件内容并放大了渲染量。
- 是否引入了 worker/highlighter/cache 的版本差异。

## Verification

针对这次修复，至少覆盖：

- `bun run --cwd packages/web-reference-react test -- src/components/diff/DiffPatchView.test.tsx`
- `bun run --cwd packages/web-reference-react test -- src/components/WorktreeDiffPane.test.tsx`
- `bun run type-check`

还需要手动验证 Electron：

- 在变更多文件的项目中展开修改型 Markdown 文件。
- 切换 unified / split。
- 折叠后再次展开。
- 确认 DevTools 不再 disconnected。

## Keywords

`@pierre/diffs`, `FileDiff`, `lineDiffType`, `word diff`, `word-alt`, `Markdown`, `Electron`, `render-process-gone`, `DevTools disconnected`, `setLanguageOverride`, `DiffPatchView`
