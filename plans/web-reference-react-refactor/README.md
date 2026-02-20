# Web Reference React Refactor Blueprint (Active)

目标：继续对 `apps/web-reference-react` 做结构优化，提升可维护性、性能与调试确定性，同时保持“协议验证客户端”定位与行为稳定（不演进为生产 UI）。

最后更新时间：2026-02-20

## 执行状态（Active）

- 进行中：Phase 6（契约层 + 渲染服务层）
- 待开始：Phase 7（runtime orchestrator 拆分）
- 待开始：Phase 8（transcript 订阅化与大会话性能）
- 当前待办：以 `plans/web-reference-react-refactor/TODO-INDEX.md` 为准

## 长期约束（不变）

- 该 app 是**协议验证客户端**，不做产品化 UI 演进。
- 语义/协议正确性第一：事件顺序、投影输出、pending input 行为稳定。
- 性能调度边界清晰：UI 可延迟，协议状态不可延迟。
- thread 切换一致性：跨线程缓存/refs/state 同步必须单一入口。

## Phase 6：契约层 + 渲染服务层（高收益、低风险）

### 6.1 RPC 契约解码层

- 新增 `src/app/core/rpcContracts.ts`：集中 `thread/start`、`turn/input/submit`、`command/dispatch`、`turn/start`、`thread/replay` 响应解码。
- 规范：runtime/action 层不再散落 `unknown` 结构解析，统一经过契约层。
- 切片：
  - 6.1-A：先建契约层与单测（不迁移调用方）
  - 6.1-B：迁移 `composerActions` / `threadActions`
  - 6.1-C：迁移 replay/data ops 调用点

### 6.2 Markdown 渲染服务化

- 从 `MarkdownRenderer.tsx` 继续拆分 `markdownService`（缓存、worker 请求、多路并发、fallback）。
- `MarkdownRenderer` 保持薄视图。
- 切片：
  - 6.2-A：抽 service 并保持行为不变
  - 6.2-B：补 service 层单测（worker error / abort / cache）

### 6.3 Thread ViewModel 统一

- 在 selector 层统一 `ThreadSummary -> ThreadViewModel`，避免 runtime 内做展示字段兜底。
- 切片：
  - 6.3-A：新增 selector + 单测
  - 6.3-B：LeftRail/useAppRuntime 接入 selector

## Phase 7：Runtime Orchestrator 拆分（中风险、中收益）

### 7.1 Orchestrator 骨架

- 新增 `src/app/runtime/orchestrator/*` 承接连接生命周期与初始化编排。
- `useAppRuntime` 保留状态绑定，不直接拼连接事务。

### 7.2 线程事务下沉

- 把“切线程 / archive rollback / replay hydrate”下沉成显式事务函数。
- 消除跨文件 ref/state 多点写入。

### 7.3 回归锁定

- 为 reconnect、切线程失败恢复、archive 失败回滚补集成测试。

## Phase 8：Transcript 订阅化与大会话性能（高风险、高收益）

### 8.1 Store 订阅化

- 引入按 selector 订阅的 transcript store（保持现有协议语义）。

### 8.2 可选 virtualization

- 为超长 transcript 增加可开关 virtualization（默认关闭，逐步放量）。

### 8.3 性能基线

- 建立固定压测场景（长 transcript + 高频 toggle + load earlier）。
- 指标：输入响应、滚动稳定性、toggle 无明显掉帧。

## 执行循环（固定）

- 每个切片：实现 -> 定向测试 -> `codex review` -> 提交。
- 切片粒度：尽量 2-6 文件。
- 阶段门禁（在 `apps/web-reference-react/` 下）：
  - `npm run type-check`
  - `npm run test`
  - `npm run test:e2e`
