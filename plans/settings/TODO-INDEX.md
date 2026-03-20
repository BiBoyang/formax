# Settings TODO Index

更新时间：2026-03-21

## 规则

- 每完成一项，立刻把 `- [ ]` 改成 `- [x]`。
- 只记录“用户可感知”的设置功能，不写纯重构杂项。
- 小步提交：优先一次只完成一个可验证项。

## 1456 对齐清单（唯一口径）

- [x] [1] 需按 `⌘ + 回车` 发送长文本提示
说明：已在 `TranscriptPane` 落地（`longTextRequireCmdEnter` + 长文本判断：多行或长度阈值）。

- [x] [4] 运行防止系统休眠
说明：desktop bridge + Electron `powerSaveBlocker` 已接入并生效。

- [x] [5] 默认打开目标（Cursor / VS Code / Finder 等）
说明：可用目标探测、设置项、生效路径、左侧 `...` 菜单 “Open in <目标>” 已落地。

- [x] [6] 语言
说明：按你原话“先保留占位”；当前保留语言设置项，不做完整 i18n 管线重构。

## 每项完成定义（DoD）

- [ ] 有最小可回归测试（单测或交互测试）。
- [ ] 手动验证路径写入提交说明（如何复现、如何确认生效）。
- [ ] `type-check` 通过，必要时补充目标包构建验证。

## 本轮验证记录

- [x] `packages/web-reference-react/src/components/TranscriptPane.tsx` 已存在 `shouldTreatAsLongPrompt` + `Cmd/Ctrl+Enter` 发送门控逻辑。
- [x] 目标测试通过：`bun run test -- src/components/TranscriptPane.test.tsx`（workdir: `packages/web-reference-react`）。
