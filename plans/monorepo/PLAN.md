## Monorepo 执行计划 v2（按“内部 core + 发布壳”策略）

### Summary

- 采用你确认的命名策略：`packages/core = @formax/core`（内部包），`@yusifeng/formax` 保持为对外发布壳与安装入口。
- 迁移顺序调整为“发布安全前置 + shared 先行子集 + semantics 抽离 + 最后目录搬迁”，避免中期出现“能跑但不能发布”状态。
- 先吸收并修正文档，再进入代码改造，确保执行中不会因计划歧义返工。

### Progress Snapshot（2026-03-13）

- 已完成：
  - `apps/* -> packages/*` 目录归一与 workspace 根接线（`workspaces: ["packages/*"]`）。
  - `@formax/semantics`、`@formax/shared` 包壳落地，并完成 app-server / web parity 对 `@formax/semantics` 的消费切换。
  - `@formax/shared` 的“零耦合子集”实化：`inputContracts`、`paramsText`、`utils/paths`、`utils/planMode`、`utils/toolFormatting`。
  - 语义层改用浏览器安全子路径 `@formax/shared/utils/planModeReminders`，消除 web build 中 `node:os/node:path` externalized 警告。
  - 发布安全门禁修正：`check-pack-safety` 允许 README 多语言命名（`README*.md`），门禁已通过。
  - CI 触发门禁补齐：`web_reference` 路径过滤已覆盖 `packages/core/src/{features/semantics,shared,prompts,streaming}`。
  - `check-shared-types` 已恢复为 monorepo 有效门禁（不再出现 “skipped”），并支持 `@formax/shared` 别名解析。
  - 高并发下的测试稳定性修复已落地（`AskUserQuestionToolBlock` / `ToolUiPrimitives` / `AgentsDialog.edgecases`）。
- 本轮已验证：
  - `bun run type-check` 通过。
  - `bun run test` 全量通过（453 files / 4246 tests）。
  - `codex review --uncommitted` 复检通过（无新的高/中风险 finding）。
  - 语义层关键定向测试（mode/slash/stream mapper/task parsing/input state）通过。
  - web parity 定向测试（`parityAdapters`、`commandSupport`）通过。
  - web build + e2e 全量通过：`npm --prefix packages/web-reference-react run build`、`test:e2e`。
  - desktop 构建链路通过：`npm --prefix packages/desktop-electron run build:main`、`build:runtime`、`build`（unpacked）、`build:mac`。
  - 治理门禁通过：`bun run check:pack-safety`、`bun run check:layer-contracts`。
- 待完成（保持原 Phase 顺序推进）：
  - web / desktop 的 `dev` 交互烟测（需要人工前台会话）。
  - Phase 4：`src -> packages/core/src` 与发布壳最终落位。

### Implementation Changes

1. **Phase 0: 文档吸收与门禁前置**

- 更新 [MIGRATION-PLAN.md](/Users/david/Documents/github/formax/plans/monorepo/MIGRATION-PLAN.md) 的执行顺序：`shared 子集先行 -> semantics`，并明确这是硬前置而非可选。
- 在计划中新增“发布冻结规则”：Phase 2/3 期间禁止 `release:beta`，直到 `pack-safety + npm pack smoke` 通过。
- 统一命名叙述：文档内所有 `@formax/core` / `@yusifeng/formax` 角色定义不再混用。
- 把“`bun build` external 策略改造”从 Phase 4 前移到 Phase 2 结束门禁。

2. **Phase 1: Workspace 化（不搬 src）**

- 根 [package.json](/Users/david/Documents/github/formax/package.json) 增加 `workspaces`，统一为 `packages/*`。
- 统一安装入口到根，移除子应用独立 lockfile 依赖路径（web/electron）。
- 改造 [build-web-ui.mjs](/Users/david/Documents/github/formax/scripts/build-web-ui.mjs)：删除子目录 `npm ci/install` 分支，改为直接在 workspace 上下文构建 web。
- CI 改为“根安装一次 + 按 workspace 执行命令”，保持现有 web e2e/perf gates 不降级。

3. **Phase 2: shared 基础子集先行 + 发布安全改造**

- 新建 `packages/shared`（内部 workspace 包），首批仅迁移“零语义耦合”的共享类型与纯工具函数。
- 暂不整体迁移 `src/features/tools/presentation/*`，先拆出纯函数子集，保留依赖 semantics 的文件在 core 侧。
- 改造 CLI 构建策略：不再使用全量 `--packages=external`；改为仅 external 第三方包，确保 `@formax/*` 被打入产物。
- 同步更新 `prepack`/`check-pack-safety` 所在执行上下文，确保检查的是“真实发布包”而非 workspace 协调器。

4. **Phase 3: 提取 `@formax/semantics` 并切换消费方**

- 新建 `packages/semantics`，迁移 `src/features/semantics`（基于 Phase 2 完成后的依赖净化版本）。
- `core` 与 `web-reference-react` 从深相对路径改为 `@formax/semantics` 包导入。
- 对 web parity 入口做一次性替换，消除 `../../../../../src/features/semantics/*`。
- 保留兼容桥接导出（短期）以降低一次性改动面，后续再清理旧路径。

5. **Phase 4: 目录归一 + 发布壳落位**

- 保持所有子项目均位于 `packages/*`，并迁移 root `src` 到 `packages/core/src`。
- 创建或保留 `@yusifeng/formax` 发布壳包，职责仅为 `bin + dist + prepack + publish`。
- `@formax/core` 作为内部实现包，由发布壳在打包阶段消费。
- 全量更新治理脚本和配置中对 `src/`、`packages/web-reference-react` 的硬编码路径（layer checks、knip、vitest、CI、CODEMAP）。

### Public APIs / Interfaces

- 对外不变：`@yusifeng/formax` 包名、`formax` 命令、安装入口保持不变。
- 内部新增包边界：
  - `@formax/shared`：共享类型与纯工具。
  - `@formax/semantics`：跨端语义核心与 reducer/selectors。
  - `@formax/core`：CLI/app-server/runtime 主实现。
- 构建接口变化：CLI build external 语义从“全部 bare import external”改为“仅第三方 external”。

### Test Plan

- Phase 1 验收：
  - 根安装成功；root + web + desktop 的 dev/build/type-check/test 通过。
  - CI 在 workspace 模式下通过同等 gate。
- Phase 2 验收：
  - `prepack` 通过；`npm pack --dry-run` 产物可执行；`check-pack-safety` 通过。
  - 无 `@formax/*` 运行时缺包问题。
- Phase 3 验收：
  - `packages/web-reference-react` 不再出现深相对导入 `src/features/semantics`。
  - semantics 相关单测与 web parity 测试通过。
- Phase 4 验收：
  - 所有治理脚本通过（layer coverage/shared types/boundaries）。
  - `release:beta --dry-run` 在新结构下通过。

### Assumptions

- 迁移期间以“稳定优先”执行，允许短期兼容桥接导出，不做一次性大清理。
- 目录大搬迁（Phase 4）不与语义抽包并行，避免故障定位复杂化。
- 文档先行更新并作为唯一执行依据，代码改造严格按 Phase gate 推进。
