# Pierre Diffs 渲染器迁移 Todo

## 0. 背景和边界

### 0.1 已确认事实
- [x] `.doms/diff.txt` 的参考 DOM 与 `@pierre/diffs` 结构匹配，包含 `diffs-container`、Shadow DOM、`data-line-type`、`--diffs-*` CSS 变量和 token span。
- [x] WebGPT 建议保留现有 diff 获取架构，优先替换渲染器。
- [x] 当前 Web diff 仍然保持“先取文件摘要，再按文件懒加载 patch”的流程。
- [x] 当前 renderer owner 仍是 `packages/web-reference-react/src/components/diff/DiffPatchView.tsx`，pane owner 仍是 `packages/web-reference-react/src/components/WorktreeDiffPane.tsx`。
- [x] Runtime 获取和 UI handler 继续分别落在 `packages/web-reference-react/src/app/runtime/diffDataOps.ts` 与 `packages/web-reference-react/src/app/runtime/diffUiHandlers.ts`。
- [x] app-server diff 数据来源仍是 `packages/core/src/app-server/devBridge.ts`。

### 0.2 本轮目标
- [x] 验证 `@pierre/diffs` 可以直接消费当前 bridge 返回的 unified patch 字符串，不改变现有获取契约。
- [x] 在 Web 侧用一个很薄的本地 adapter 封装 `@pierre/diffs`，不把库细节泄漏到 `WorktreeDiffPane`。
- [x] 保留现有懒加载、stale、loading、error 行为。
- [x] 用 `@pierre/diffs` 完整替换旧手写 `DiffPatchView`，不保留长期兼容路径。
- [x] 为新 renderer 行为和 pane 集成补齐聚焦测试。
- [x] 保持 renderer-only 范围，不改 bridge RPC 名称，也不改 Git 命令语义。

### 0.3 非目标
- [x] 本轮没有重写 diff 获取层。
- [x] 本轮没有替换 Git CLI 方案。
- [x] 本轮没有重命名或删除现有 app-server/Web diff RPC 契约。
- [x] 本轮没有实现 hunk streaming、服务端渐进式 fetch、split view、行评论、accept/reject hunk 或行内编辑。
- [x] 本轮没有扩展 bridge metadata 解析。

## 1. 先定义，再实现

### 1.1 Canonical docs
- [x] 确认为 renderer-only 迁移，不需要更新 canonical contract。
- [x] 评估后确认 `CODEMAP.md` 现有 “Patch rendering primitives: src/components/diff/*” 所有权描述仍然准确，因此无需额外改动。
- [x] app-server/Web diff contract 文档维持不变，后续仅在 bridge metadata 真正变化时再更新。

### 1.2 数据模型
- [x] 第一轮继续以按文件返回的 `patch: string` 作为主要渲染器输入。
- [x] 保留文件摘要 metadata 形状，包括 `path`、`additions`、`deletions`、load/error state。
- [x] adapter 边界已收敛为“输入 unified patch，输出已渲染 diff 元素或稳定 unavailable state”。
- [x] 结论是 raw patch API 可用：`PatchDiff` 直接吃 unified patch，`parsePatchFiles` 仅用于预校验。
- [x] 未引入自写 hunk parser，也未新增 before/after contents fetching。
- [x] 已定义大 patch 与异常 patch 策略，且策略不会回退到旧 renderer。

### 1.3 Types / Interfaces
- [x] 本地 renderer props interface 已覆盖 `path`、`patch`、`truncated?`、`additions?`、`deletions?`。
- [x] 库类型、动态 import、custom element 初始化和 unsafe CSS 细节都限制在 `DiffPatchView.tsx` 内部。
- [x] `WorktreeDiffPane.tsx` 没有直接感知 `@pierre/diffs` 的 custom-element 细节。
- [x] adapter failure reasons 已收敛为 `invalid_patch`、`unsupported_patch`、`large_patch`、`truncated_patch`、`renderer_error`、`empty_patch`、`binary_patch`。
- [x] failure UI 稳定显示 unavailable state，不 crash、不回退旧 renderer，并保留 path 与 +/- metadata。

### 1.4 语义决策
- [x] 获取架构保持 summary-first / per-file lazy patch fetch。
- [x] 默认展示继续使用 unified diff。
- [x] 失败态明确显示 unavailable，而不是静默失败或空白。
- [x] Git `-z` metadata 加固被明确留到后续 backlog，不混入本轮 renderer-only 交付。
- [x] 库所有权继续通过本地 `DiffPatchView` boundary 封装。

## 2. Runtime / Platform
- [x] 渲染器迁移期间没有改动 `packages/core/src/app-server/devBridge.ts` 行为。
- [x] 本轮没有引入新的 Git dependency。
- [x] 本轮没有为了渲染器迁移新增 bridge helper 或改动 runtime state handler。

## 3. Frontend 边界
- [x] `DiffPatchView.tsx` 已成为唯一的 `@pierre/diffs` adapter 落点。
- [x] `WorktreeDiffPane.tsx` 继续只负责 pane 编排、refresh、selection、expanded file、loading、stale 与 error。
- [x] `diffDataOps.ts` 和 `diffUiHandlers.ts` 保持不变。
- [x] CSS/theming 只在 renderer 内通过 `unsafeCSS` 和现有变量对齐，没有引入无关全局样式。
- [x] 当前 Web build 环境已验证可正常使用 custom elements 与 Shadow DOM。
- [x] 不存在 old renderer runtime branch，也不存在回退到旧 renderer 的逻辑。

## 4. 测试与验证
- [x] `packages/web-reference-react/src/components/diff/DiffPatchView.test.tsx` 已改写为新 renderer contract。
- [x] `packages/web-reference-react/src/components/WorktreeDiffPane.test.tsx` 已覆盖 pane 集成、新 renderer 失败展示、lazy fetch、stale response 和 refresh 行为。
- [x] Adapter tests 已覆盖 modified file、added file、deleted file、rename without hunks、binary patch、empty patch、invalid patch、truncated patch、large patch 和 prop update。
- [x] Pane tests 已覆盖 lazy fetch、loading state、patch unavailable 不自动无限 retry、snapshot refresh 后 expanded row 重新请求 patch、stale response 不覆盖新 snapshot、121+ files/truncated snapshot 行为。
- [x] 为适配 `@pierre/diffs` 的动态 import，在测试中补充了 `vi.dynamicImportSettled()` + `act()` 同步策略，并将 pane 文件级超时抬到合理窗口，避免 JSDOM/动态 import 时序噪音。
- [x] `packages/web-reference-react/src/test/setup.ts` 已补齐 `CSSStyleSheet.replaceSync` 与 storage polyfill，保证测试环境稳定。
- [x] `packages/web-reference-react/src/app/i18n/messages.ts` 已补齐 unavailable / loading / partial preview 文案的中英文消息。

### 4.1 已执行命令
- [x] `bun run --cwd packages/web-reference-react test src/components/diff/DiffPatchView.test.tsx`
- [x] `bun run --cwd packages/web-reference-react test src/components/WorktreeDiffPane.test.tsx`
- [x] `bun run --cwd packages/web-reference-react type-check`
- [x] `bun run --cwd packages/web-reference-react build`
- [x] `PLAYWRIGHT_SKIP_WEBSERVER=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173 bun run --cwd packages/web-reference-react test:e2e -- e2e/diff-collapsible.spec.js`

### 4.2 Smoke notes
- [x] 已避开本机 `3781` 复用问题，改用独立端口 `http://127.0.0.1:4173` 运行本地 dev server。
- [x] isolated-port Playwright smoke 已验证线程进入、diff 行展开、Shadow DOM 内 old/new 行可见，以及收起后 renderer 节点消失。
- [x] build 仍有 Vite/Radix/`@pierre/diffs` 的 `"use client"` 与 chunk-size warnings，但命令成功，不构成当前交付阻断。

## 5. Review

### 5.1 Triage
- [x] 所有 review finding 都先按 `true blocker` / `later-loop` / `spec ambiguity` / `reviewer preference` / `conflicts with accepted contract` 分类。
- [x] 本轮唯一有效 finding 被归类为 `true blocker`：动态 import 失败后 promise reject 被永久缓存，会让 renderer 在整页刷新前都无法重试。
- [x] 已在 `DiffPatchView.tsx` 中修复该 blocker：动态 import 失败时清空模块 promise 缓存，允许后续重试。
- [x] 后续无新的 actionable findings。

### 5.2 Review runs
- [x] 已创建 `docs/pierre-diffs-renderer-review-findings-log.md`，因为本任务执行了多次 `codex review`。
- [x] 首轮 `codex review --uncommitted -c model="gpt-5.3-codex" -c model_reasoning_effort="medium"` 给出 1 条 P2 finding，并已修复。
- [x] 修复后再次以同样参数运行 `codex review`，结果为 “I did not identify any actionable regressions.”

## 6. 收尾
- [x] 已确认不存在 smoke-only kill switch，也不存在回退旧 renderer 的隐藏分支。
- [x] 已确认 `ToolUiBlocks` 等其他调用方继续通过 `DiffPatchView` 这一所有权边界使用新 renderer。
- [x] 本轮 renderer 迁移的实现、测试、build、isolated-port smoke 和 review 都已闭环。

## 7. 已记录的后续项
- [x] 已把 `git diff --name-status -z` / `git diff --numstat -z` 风格解析加固记录为后续 backlog。
- [x] 已把 bridge-level metadata shape 变化是否需要 contract doc 记录为后续 backlog 决策点。
- [x] 已把 hunk-level expansion / progressive patch fetching 记录为独立后续项。
- [x] 已把 split view 和 line-level actions 记录为独立 UX 任务。
- [x] 已把“若未来发现 `@pierre/diffs` 覆盖不了使用范围，再评估极小 renderer 替代方案”记录为保底 follow-up。
