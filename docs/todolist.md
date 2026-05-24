# Model Context Window Stability Todo

## 0. Context and Boundary

### 0.1 Confirmed facts
- [x] 当前问题主线不是单一 provider 字段误读，而是 `model identity`、`model capability`、`persisted override`、`effective runtime budget` 混成了多个裸数字字段。
- [x] setup 当前会把 provider list explicit metadata、detail probe、`models.dev` catalog、heuristic fallback 最终压平成可消费窗口值，需要额外 provenance 才能稳定。
- [x] runtime `contextWindowTokens` 之前只暴露数值优先级，不暴露 source / binding。
- [x] Web / app-server 之前会缓存 `TurnRunner` 的 runtime/client，但 turn 内又会重新读取 config budget，存在 cached model 与 fresh budget 混用风险。
- [x] Anthropic-compatible provider 的 `max_tokens` 语义不稳定；实现已改为不再直接把它当作 context window。

### 0.2 Goals
- [x] 给 context window 引入明确的 source / binding / runtime ownership，避免不同来源的数字互相冒充。
- [x] 稳定 setup 到写盘的能力探测链路，避免 heuristic 或低置信度来源被静默持久化成“真实窗口”。
- [x] 让 app-server / Web turn 执行使用同一个 runtime model profile，消除 cached model 与 fresh budget 脱节。
- [x] 在不改变当前用户可见模型选择语义的前提下，给后续结构化重构留清晰迁移路径。

### 0.3 Non-goals
- [x] 本任务不重构大范围 context compression / transcript / tool runtime 子系统。
- [x] 本任务不顺手 redesign setup UI 或 Web GUI 视觉表现。
- [x] 本任务不在第一轮就引入完整 capability cache / provider adapter registry 重构。
- [x] 本任务不立即移除 legacy `llm.contextWindowTokens`；先把它降级为兼容 mirror。

## 1. Definitions First

### 1.1 Canonical docs
- [x] 更新 `docs/contracts/model-settings-contract.md`，明确区分 active model identity、detected capability、persisted tier snapshot / override、effective runtime prompt budget。
- [x] 在合同中补充 invariant：同一 turn 的 runtime model 与 runtime budget 必须来自同一份 frozen profile；persisted snapshot 绑定 model identity；env override 不得写回；legacy scalar 只作兼容 mirror。
- [x] 保持短期只扩展现有 `model-settings-contract`，不额外拆 capability canonical doc。
- [x] 补充 `docs/learnings/2026-05-24-context-window-source-binding-runtime-profile.md` 记录收敛原则。

### 1.2 Data model
- [x] 定义最小新增状态：model context window source、confidence、bound model identity、runtime profile fingerprint。
- [x] 固定 source taxonomy：`CapabilitySource`、`ConfigBudgetSource`、`ModelSource`。
- [x] 明确哪些来源可作为 persisted snapshot，哪些来源只能作为 runtime fallback。
- [x] 将 `binding_mismatch` 提升为正式 resolution path，而不是隐式继续吃旧 tier 数值。
- [x] 保留 legacy mirror，但不再把它当成新的 tier truth。

### 1.3 Types / Interfaces
- [x] 扩展 setup connection 结果，保留兼容 `modelContextWindows`，同时新增 provenance metadata。
- [x] 扩展 runtime config 返回值，增加 `contextWindowTokensSource`、`contextWindowTokensBoundModel`、`modelSource` 等字段。
- [x] 引入 `RuntimeModelProfile` 与 profile fingerprint。
- [x] 统一 setup 与 detection 的 heuristic helper，避免 fallback 规则分叉。

## 2. Runtime / Platform

### 2.1 Provider capability detection
- [x] 保持探测顺序：explicit metadata → detail probe → catalog → heuristic。
- [x] 在 `connectionTest` 保留 provenance。
- [x] 对 Anthropic-compatible / OpenAI-compatible 分开约束可视为 context window 的字段。
- [x] 把 `known_model_map` 留在 runtime/config resolution，而不是混入 provider-facing detection。

### 2.2 Setup state and persistence
- [x] setup session 现在让 tier model 与 tier context metadata 同步推进，quick / advanced 模式切换时一起复制。
- [x] `writeSetupFiles` 只持久化与已选 tier model 绑定的 snapshot / override。
- [x] heuristic fallback 默认不再被 setup 静默固化成 authoritative snapshot。

### 2.3 Config resolution
- [x] `loadRuntimeConfig` 仍保持 effective value 行为，但同时返回 source / binding metadata。
- [x] `/model` sync 改为 source-aware，并通过 `resolveRuntimeModelProfile(...)` 解析 effective source / binding。
- [x] env override 仍然优先，但被明确为 runtime override，而不是 capability。
- [x] `known_model_map` 现在只在 runtime/config resolution 主线生效。

### 2.4 App-server / Web runtime ownership
- [x] `TurnRunner` 现在在 turn 开始时冻结 `RuntimeModelProfile`，同一 turn 不再独立 reload model/budget/provider。
- [x] app-server `resolveTurnRunner` 改为 profile-keyed cache / rebuild 策略。
- [x] diagnostics 与 actual turn 都通过 shared runtime profile resolver 收敛到同一 ownership。
- [x] turn 内 model、budget、provider/cache-editing 判定来自同一份 frozen profile。

## 3. Frontend Boundary

### 3.1 Diagnostics and explainability
- [x] context meter / diagnostics raw budget 现在暴露更细的 source，而不是只有 `runtime_config` / `known_model_window`。
- [x] 可观测面增加了 bound model 与 profile fingerprint。

### 3.2 Scope guard
- [x] 保持当前 UI copy 和主交互语义稳定，没有额外视觉或交互重排。
- [x] runtime ownership 问题没有下沉成前端组件局部 workaround。

## 4. Tests

### 4.1 Detection and setup tests
- [x] 扩展 `packages/core/src/adapters/setup/connectionTest.test.ts`，覆盖 detected/detail probe/catalog/heuristic source 与 `max_tokens` 回归。
- [x] 扩展 `packages/core/src/core/setup/session.test.ts`，锁住 quick / advanced source 复制与 metadata fallback。
- [x] 扩展 `packages/core/src/adapters/setup/writeSetupFiles.test.ts`，覆盖 authoritative snapshot 与 low-confidence fallback 写盘边界。

### 4.2 Config and command tests
- [x] 扩展 `packages/core/src/config/config.branches.test.ts`，覆盖 source/binding metadata、env override、binding mismatch。
- [x] 新增 `packages/core/src/config/runtimeModelProfile.test.ts`，覆盖 persisted source、known-model fallback、binding mismatch。
- [x] 扩展 `packages/core/src/features/commands/replEnvironmentService.test.ts`，覆盖 source-aware `/model` sync 与 env-only override 不写盘。

### 4.3 App-server / runtime tests
- [x] 更新 `packages/core/src/app-server/turnRunner.test.ts`，锁住 frozen profile 下的 context meter raw 行为。
- [x] 更新 `packages/core/src/app-server/index.coverage.test.ts`，锁住 profile-keyed runner cache 与 live plan diagnostics。
- [x] 更新 `packages/core/src/chat/context/contextDiagnostics.test.ts`，锁住 diagnostics payload 与 runtime profile source 对齐。

## 5. Execution Result

### Loop 1
- [x] 收敛 canonical 定义、source taxonomy、shared helper、基础类型与 targeted tests。

### Loop 2
- [x] 完成 connectionTest provenance、setup session metadata 与 write boundary 收敛。

### Loop 3
- [x] 完成 runtime config source/binding 元数据、`resolveRuntimeModelProfile(...)`、`/model` source-aware sync。

### Loop 4a
- [x] 让 `TurnRunner` 冻结 turn 级 runtime profile，消除 turn 内独立 reload 分叉。

### Loop 4b
- [x] 将 app-server runtime cache 切到 profile-keyed，并让 diagnostics / actual turn 共享 owner。

### Loop 5
- [x] 在 diagnostics / context meter 暴露 source / bound model / profile fingerprint。
- [x] 完成文档、learnings、targeted tests、type-check 与最终 review 收口。
