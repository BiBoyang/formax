# REPL Surface Debugging Runbook

本 runbook 用于排查 REPL transcript 在真实终端上的物理 surface 问题，尤其是：
- `/clear` 闪屏或需要执行两次
- `/resume` 选会话后黑屏
- Ctrl+O / Ctrl+E / `/compact` 后 header 或 transcript 重复
- Static 路径下出现 stale rows / duplicate rows / flicker

规范性事实源见：`docs/contracts/transcript-surface-contract.md`。

## 1. 先分层：这是数据层问题还是 surface 问题

优先判断：
1. 若同一 `toolUseId` / `message.id` 在逻辑数据中只有一份，但终端上出现两份，优先按 surface 问题处理。
2. 若逻辑数据本身就重复或顺序错误，先回到 canonical semantics / handoff 排查，不要先打 surface 补丁。

辅助信号：
- 开启 `FORMAX_HOOKS_DEBUG=1` 时，tool suffix 能显示 `surfaceOwner/message.id/toolUseId`，可用来区分“同一物理 surface 重打”还是“数据层真的生成了两行”。

## 2. 症状 -> 首查路径

| 症状 | 优先检查 |
|---|---|
| `/clear` 执行一次后旧内容回来了 | `runNewSessionTransition` 是否走 `replaceTranscript([])`；legacy runner 是否只有一个 clear owner |
| `/resume` 选会话后黑屏 | `runResumeSessionTransition` 是否 `await replaceTranscript(...)`；是否绕过 `surfaceOpQueueRef` |
| Ctrl+O / Ctrl+E / `/compact` 后 header/banner 重复 | `useSurfaceTransitionManager` 是否为视图切换/compact boundary 请求 reset |
| forced Static 下 tool row 重复但数据没重复 | `transcriptSeq` / Static key 是否真的变了；是否试图做 non-append correction 而没 remount |

## 3. 修复路径

### 3.1 `/clear` / `/resume`

要求：
1. 不要手工拼 `setMessages` + `onClearTerminal` + `setTranscriptSeq`。
2. 使用 `replaceTranscript(...)` 作为唯一入口。
3. 必须 `await replaceTranscript(...)`，不要 fire-and-forget。

对应文件：
- `src/features/repl/controller/session/sessionTransitions.ts`
- `src/features/repl/useReplController.ts`

### 3.2 Ctrl+O / Ctrl+E / compact

要求：
1. 视图切换由 committed state 驱动 reset，不要在 key handler 里零散 clear。
2. expanded view active 切换、expanded hide-history 切换、compact boundary 插入，都走 `useSurfaceTransitionManager`。

对应文件：
- `src/screens/repl/useSurfaceTransitionManager.ts`
- `src/screens/REPL.tsx`
- `src/screens/repl/transcriptKey.ts`

### 3.3 Legacy terminal clear path

要求：
1. 只有 `resetInkStaticOutputForStdout(process.stdout)` + `clearTerminal()` 这一条 clear path。
2. 不要再加 `replInstance.clear()` 或第二套 ANSI clear path。

对应文件：
- `src/runtime/bootstrap/runLegacyCli.tsx`

### 3.4 非 append 修正

如果你发现修复需要“改掉已经打到 `Static` 上的旧行”：
1. 先假设当前问题不能靠 render-edge merge 修好。
2. 直接走 shared reset transaction。
3. 不要把 header/messages 搬出 `Static` 当 workaround。

## 4. 最小验证清单

先跑：
1. `bun run test -- src/features/repl/controller/ui/surfaceReset.test.ts`
2. `bun run test -- src/features/repl/controller/session/sessionTransitions.test.ts`
3. `bun run test -- src/screens/repl/useSurfaceTransitionManager.test.tsx`
4. `bun run test -- src/screens/repl/surfaceSmoke.test.tsx`

触及 `/clear`、`/resume`、compact 主流程时，再补：
5. `bun run test -- src/features/repl/useReplController.test.tsx -t "resume|clear|compact"`
6. `bun run type-check`

若改动包含 Ctrl+O / Ctrl+E / compact 的真实 surface 返回路径，再跑：
7. `bun run test:surface-screen-model`

## 5. 红线

以下情况说明修复方向错了：
1. 新增 feature-local `onClearTerminal()` 直调，但该路径本来已能访问 shared reset queue。
2. `/clear` 或 `/resume` 又出现独立 clear/remount 顺序逻辑。
3. 通过把 header/messages 挪出 `Static` 来“消掉重复”。
4. forced Static smoke 还没跑，就声称问题只在真实终端出现。

## 6. 相关资料

- `docs/contracts/transcript-surface-contract.md`
- `docs/pitfalls/repl-transcript-static-rootcause.md`
- `docs/pitfalls/repl-transcript-surface-handoff-pitfall.md`
- `pitfalls.md`
