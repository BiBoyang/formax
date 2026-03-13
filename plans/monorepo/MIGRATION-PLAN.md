# Monorepo 改造计划

最后更新：2026-03-13

## 已知风险（Review 修正）

> [!CAUTION]
> **`--packages=external` 与 `workspace:*` 冲突**
> 当前 CLI 构建命令是 `bun build packages/core/src/entrypoints/cli.tsx --outfile dist/cli.js --target=node --packages=external`。
> 这意味着所有 bare import（如 `@formax/semantics`）会被保留为外部依赖，但 `@formax/semantics` 不会发布到 npm，用户环境装不到。
> **对策**：内部 workspace 包必须被 bundle 进产物，不能 external。有两种做法：
>
> 1. **推荐**：改用 `--external` 只排除真正的第三方包（`@anthropic-ai/sdk`、`openai`、`ink` 等），不排除 `@formax/*`
> 2. **备选**：继续用相对路径 import semantics（不走 bare import），bun build 会自动 inline

> [!WARNING]
> **`@formax/semantics` 并非零依赖**
> 实际有 17 处外部 import，涉及 `prompts/`、`shared/`、`streaming/`、`tools/presentation/` 四个模块族。
> 直接平移会引发连锁搬迁。Phase 2 前需要先做依赖方向清理（见下文详述）。

> [!WARNING]
> **Phase 4 与发布身份冲突**
> 当前 npm 包名是 `@yusifeng/formax`，用户通过 `npx @yusifeng/formax` 安装。
> 如果把 root 变成纯协调器、core 挪到 `packages/core/`，需要确保 `packages/core/package.json` 继承 `@yusifeng/formax` 的包名和 `bin` 入口，否则发布流程大改。

## 目标

将 Formax 从单 package 结构改造为 monorepo，解决：

1. `web-reference-react` 通过 `../../../../../src/` 深层相对路径引用 root 语义核心
2. 多份独立 lockfile（root `bun.lock`、web `bun.lock`、electron `package-lock.json`）的漂移风险
3. 跨端共享代码没有正式的包边界

## 设计决策

| 决策点            | 结论                                          | 理由                                                 |
| ----------------- | --------------------------------------------- | ---------------------------------------------------- |
| 目录布局          | 统一 `packages/*`，不分 `apps/` + `packages/` | 包数量 ≤ 5，平铺更简单；未来膨胀再拆                 |
| core 与 CLI       | 放在同一个包 `packages/core/`                 | CLI 与 core 深度耦合，拆出需 export 几乎所有内部模块 |
| Workspace manager | bun workspaces                                | 已在用 `bun.lock`，语法兼容 npm workspaces           |
| TS 配置           | `tsconfig.base.json` + 各包 extends           | 避免重复配置                                         |

## 目标结构

```
formax/
├── package.json                 ← workspace root（workspaces: ["packages/*"]）
├── tsconfig.base.json           ← 共享 TS 基础配置
├── vitest.workspace.ts          ← 可选：统一测试入口
│
├── packages/
│   ├── core/                    ← @formax/core
│   │   ├── package.json         ← 依赖 @formax/semantics, @formax/shared
│   │   ├── tsconfig.json
│   │   ├── vitest.config.ts
│   │   ├── bin/
│   │   └── packages/core/src/                 ← 当前 root packages/core/src/ 整体（去掉 features/semantics）
│   │
│   ├── semantics/               ← @formax/semantics
│   │   ├── package.json         ← 依赖 @formax/shared（清理后）
│   │   ├── tsconfig.json
│   │   └── packages/core/src/                 ← 当前 packages/core/src/features/semantics/*（清理后）
│   │
│   ├── shared/                  ← @formax/shared
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── packages/core/src/                 ← 跨端共享类型 + presenter 接口
│   │
│   ├── web-reference-react/     ← formax-web-reference-react
│   │   └── ...                  ← 现有内容，import 改为 @formax/semantics
│   │
│   └── desktop-electron/        ← formax-desktop-electron
│       └── ...                  ← 现有内容
│
├── scripts/                     ← 治理 / CI 脚本
├── docs/                        ← 治理文档
└── plans/                       ← 过程计划
```

---

## Phase 1：启用 Workspaces（统一 lockfile）

### 目标

让现有多个 `package.json` 由统一 workspace manager 管理。不拆 `packages/core/src/`。

### 步骤

1. root `package.json` 添加 `"workspaces": ["packages/*"]`
2. 删除 `packages/web-reference-react/bun.lock` 和 `packages/desktop-electron/package-lock.json`
3. root 执行 `bun install`，确认所有依赖提升到 root `node_modules`
4. 修改 `scripts/build-web-ui.mjs`：移除子目录 `npm ci / npm install` 逻辑
5. 修改 `packages/desktop-electron/scripts/build-runtime.mjs`：确认 build 仍正常
6. 验证：
   - `bun run dev` 正常
   - `bun run build` 正常
   - `cd packages/web-reference-react && bun run dev` 正常
   - `cd packages/web-reference-react && bun run build` 正常
   - `bun run test` 全部通过
   - `bun run type-check` 通过

### 风险

- peer dependency 版本冲突（react、typescript 版本需对齐）
- web-reference-react 的 vite 插件可能依赖本地 `node_modules` 的物理路径

---

## Phase 2：提取 `@formax/semantics`

### 前置：依赖方向清理

当前 `packages/core/src/features/semantics/` 有 17 处向外部模块的 import，必须先清理才能干净提取：

| 文件                                           | 外部依赖                                                                         | 处理方式                                                             |
| ---------------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `core/canonicalEvents.ts`                      | `streaming/types` (TokenUsage), `shared/inputContracts` (InputKind, InputStatus) | → 这些类型应先移入 `@formax/shared` 或 semantics 自身                |
| `core/modeSemantics.ts`                        | `prompts/types` (PromptBlock), `shared/utils/planMode`                           | → PromptBlock 移入 shared；planMode 工具函数移入 shared 或 semantics |
| `core/slashSemantics.ts`                       | `prompts/init` (buildInitPrompt)                                                 | → 反转依赖：由 core 注入 initPrompt，semantics 不直接引用 prompts    |
| `adapters/streamEventCanonicalMapper.ts`       | `tools/presentation/paramsText`, `shared/utils/toolResultContent`                | → paramsText 移入 shared；toolResultContent 已在 shared              |
| `adapters/streamCanonicalAdapter.ts`           | `streaming/types` (StreamEvent)                                                  | → StreamEvent 类型移入 shared                                        |
| `adapters/crossPathContractFixture.ts`         | `streaming/types` (StreamEvent)                                                  | → 同上                                                               |
| `adapters/turnInputBuilder.ts`                 | `prompts` (PromptBlock, buildUserContent)                                        | → PromptBlock 移入 shared；buildUserContent 通过注入                 |
| `adapters/turnNotificationCanonicalAdapter.ts` | `shared/inputContracts`                                                          | → 已在 shared，直接依赖 @formax/shared                               |
| `adapters/toolEventCanonicalFields.ts`         | `shared/utils/toolResultContent`                                                 | → 已在 shared                                                        |
| `runtime/inputStateMachine.ts`                 | `shared/inputContracts`                                                          | → 已在 shared                                                        |
| `runtime/threadRuntimeState.ts`                | `shared/inputContracts`                                                          | → 已在 shared                                                        |
| `selectors/taskResultParsing.ts`               | `shared/utils/toolFormatting`                                                    | → 已在 shared                                                        |
| `projection/transcriptProjectionTypes.ts`      | `streaming/types` (TokenUsage)                                                   | → TokenUsage 移入 shared                                             |

**结论**：Phase 2 依赖 Phase 3（shared）先行提取部分内容。实际执行顺序调整为 **Phase 3 部分先行 → Phase 2**，或者合并为一步。

### 目标

消除 web-reference-react 通过 `../../../../../src/features/semantics/` 的深层 import。

### 步骤

1. 创建 `packages/semantics/`，含 `package.json`（`"name": "@formax/semantics"`）
2. 创建 `packages/semantics/tsconfig.json`（extends `../../tsconfig.base.json`）
3. 将 `packages/core/src/features/semantics/` 整体移入 `packages/semantics/src/`
4. `packages/semantics/src/index.ts` 做 barrel export
5. root `package.json`：
   - `workspaces` 保持 `["packages/*"]`
   - 需要时为消费方增加 `"@formax/semantics": "workspace:*"`
6. root `packages/core/src/` 中所有 `from '../features/semantics/...'` 改为 `from '@formax/semantics'`
7. `packages/web-reference-react/package.json` 加 `"@formax/semantics": "workspace:*"`
8. `packages/web-reference-react/src/parity/semantics/index.ts` 的 17 处深层 import 全部改为 `from '@formax/semantics'`
9. 验证：同 Phase 1 验证清单 + web-reference-react e2e

### 关键影响文件

```
packages/core/src/features/semantics/         → packages/semantics/src/
  core/canonicalEvents.ts
  core/modeSemantics.ts
  core/replModeTransition.ts
  core/slashSemantics.ts
  core/commandRouting.ts
  projection/transcriptProjection.ts
  runtime/inputStateMachine.ts
  runtime/threadRuntimeState.ts
  runtime/threadArchiveSemantics.ts
  adapters/turnInputBuilder.ts
  adapters/canonicalEventAdapter.ts
  adapters/crossPathContractFixture.ts
  selectors/invariants.ts
  selectors/transcriptSegments.ts
  __tests__/*
```

### 风险

- ~~semantics 内部可能反向 import `packages/core/src/` 其他模块~~ **已确认存在 17 处**，见上文清理表
- 测试 fixtures（如 `crossPathContractFixture.ts`）引用 `StreamEvent` 类型，需 shared 先就位
- 清理过程中可能发现更多隐式耦合（通过 re-export 间接引入的）

---

## Phase 3：提取 `@formax/shared`

### 目标

将跨端共享的类型定义和 presenter 接口独立为包。

### 候选内容

| 来源                                      | 用途                              |
| ----------------------------------------- | --------------------------------- |
| `packages/core/src/shared/toolPresenterContracts.ts`    | TUI + Web 共用 presenter 接口     |
| `packages/core/src/features/tools/presentation/*`       | web parity 测试直接引用的展示逻辑 |
| `packages/core/src/app-server/protocol.ts` 中的类型子集 | JSON-RPC 消息类型（web 端需要）   |
| `packages/core/src/streaming/types.ts` 中的共享类型     | stream event 类型定义             |

### 步骤

1. 创建 `packages/shared/`
2. 逐个迁移上述候选内容，每迁一个验证一次
3. core 和 web-reference-react 加 `"@formax/shared": "workspace:*"`

### 风险

- 边界划分需要逐个文件判断，不像 semantics 那样有清晰的目录边界
- 过度提取会导致 shared 变成垃圾桶包

---

## Phase 4：目录整理（packages-only）

### 目标

保持子项目位于 `packages/`，并将 root `packages/core/src/` 移入 `packages/core/`，root 变为纯 workspace 协调器。

### 发布身份约束

npm 包名 `@yusifeng/formax` 和 `bin.formax` 入口必须保持不变。两种做法：

1. **推荐**：`packages/core/package.json` 直接使用 `"name": "@yusifeng/formax"`，root 不再是可发布包
2. **备选**：root 保留 `@yusifeng/formax` 包名，作为 thin wrapper re-export `packages/core`

### 步骤

1. `mkdir packages/core && mv src packages/core/src`
2. 将 root `package.json` 的 `scripts`/`dependencies`/`devDependencies`/`bin` 移入 `packages/core/package.json`
3. root `package.json` 简化为只含 `workspaces` + 共享 devDeps
4. 批量更新 `scripts/check-*.mjs` 中的路径假设（`packages/core/src/` → `packages/core/src/`）
5. 更新 `tsconfig.json` → `tsconfig.base.json`，`packages/core/tsconfig.json` extends it
6. 更新 CI、`CODEMAP.md`、`ARCHITECTURE.md`
7. 更新 `bun build` 命令中的入口路径和 `--external` 列表
8. 确保 `prepack` 脚本链路完整（build → build:web-ui → check:pack-safety）

### 风险

- 工作量最大的阶段：`scripts/` 下 ~20 个治理脚本硬编码了 `packages/core/src/` 路径
- `bun build` 入口路径、`bin/formax.js` 的相对路径都需要调整
- `layer-contract.config.json` 等配置文件的路径假设需要全部更新
- `desktop-electron/scripts/build-runtime.mjs` 中 `repoRoot/dist/cli.js` 路径需更新
- `knip.json`、`vitest.config.ts`、`.gitignore` 等配置文件需同步

---

## 依赖图（目标态）

```
@formax/shared       ← 零外部依赖（纯类型 + 工具函数）
       ↑
@formax/semantics    ← 依赖 @formax/shared
       ↑
@formax/core         ← 依赖 semantics + shared + 外部 deps
       ↑
  ┌────┴────┐
  │         │
web-ref   desktop-electron
  │         │
  ├── @formax/semantics
  └── @formax/shared
```

## 验证清单（每个 Phase 完成后）

- [x] `bun install` 无报错
- [x] `bun run type-check` 通过
- [x] `bun run test` 全部通过
- [x] `bun run build` 产物正确
- [x] `bun run build:web-ui` 正常
- [ ] web-reference-react `dev` / `build` / `e2e` 正常（当前：`build + e2e` 已通过，`dev` 交互烟测待人工确认）
- [ ] desktop-electron `dev` / `build` 正常（当前：`build:main`、`build:runtime`、`build(unpacked)` 已通过，`dev` 交互烟测待人工确认）
- [x] `check-layer-contracts` 等治理脚本通过（当前：`check-layer-contracts` 已通过；Phase 4 后仍需复验）
