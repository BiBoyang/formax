# Semantics Architecture Blueprint（Next）

更新时间：2026-02-17

## 1. 目的

本文件作为“语义化下一阶段”的架构蓝图，目标是把当前已完成的单点优化，收敛为可持续演进的系统约束，减少后续回归与补丁式修复。

本文件不是执行 TODO；它定义“先做什么、为什么做、做到什么算完成”。

---

## 2. 当前共识（已达成）

1. TUI / Web / app-server 必须共享同一语义来源，而不是各自维护一套 turn 组装逻辑。  
2. 语义正确性优先于 UI 呈现细节；UI 差异应在 renderer 层解决。  
3. 长期方向是单写入源（single-writer），避免双写与尾部回填止血。  
4. Canonical envelope 权威按路径分层：app-server 路径由 server 产出并保证稳定；local TUI 路径可由 runtime 产出，但必须遵循同一 contract 且语义不分叉。  

---

## 3. 架构目标（Next）

### G1. 单一语义写入源（Single Writer）

- 业务流程只能发 canonical events，不允许直接写 transcript 消息。
- transcript 由 projection 纯函数产出，禁止旁路写入。

### G2. 语义契约稳定化（Contract Governance）

- canonical envelope 与事件字段定义硬约束（必填/可选/扩展位）。
- 建立版本策略（兼容扩展 vs 破坏性变更）。

### G3. 投影与展示解耦（Projection vs Renderer）

- projection 层只维护语义状态，不携带特定 UI 的展示偏好。
- TUI/Web 通过 selector + renderer 派生展示内容。

### G4. 实时与恢复一致（Realtime = Replay）

- 同一事件序列，实时消费与 replay 重建结果必须一致。
- gap/restart/reconnect 路径必须回到同一恢复流程。

---

## 4. 分层边界（强约束）

### 4.1 Event Layer

- 输入：stream event / turn notification / persisted replay record  
- 输出：canonical event（统一 envelope）
- 权威规则：app-server 路径下客户端不得补造 envelope 进入 projector；local TUI 路径可在 runtime 侧生成 envelope，但字段契约与排序语义必须与 server 路径等价。

### 4.2 Projection Layer

- 输入：canonical event 序列  
- 输出：transcript projection state（segments + sticky maps + turn/runtime state）
- 要求：纯函数、可回放、可幂等

### 4.3 Selector Layer

- 输入：projection state + UI mode/context  
- 输出：view model（TUI/Web 各自可渲染结构）
- 要求：不修改 projection state

### 4.4 Renderer Layer

- 输入：view model  
- 输出：终端/网页 UI  
- 要求：只关心呈现，不承载语义纠偏逻辑

---

## 5. 不变量（Invariants）

1. 同一 turn 内，`toolUseId` 不得出现重复最终 tool row。  
2. `replaySeq` 是跨端排序主键，不能退化为本地时间序。  
3. `turn/input` 生命周期必须有终局（no pending leak）。  
4. 已完成/已失败 turn 的最终 transcript 不允许被后续事件回写篡改。  
5. 同一 fixture 的 realtime 输出与 replay 输出应结构一致。  

---

## 6. 风险点与对应策略

### R1. 双写残留导致“偶发重复行/丢行”
- 策略：收紧写入入口；加 dev invariant + contract fixture。

### R2. 协议新增字段导致各端理解漂移
- 策略：先改 contract 文档与 adapter，再改消费端；保持向后兼容。

### R3. 高频 streaming 下性能回退
- 策略：changed-signal、dirty-id、批处理/节流；先做测量后调参。
- 基线：`bun run check:semantic-streaming-perf`（见 `docs/baselines/semantic-streaming-perf.md`）。

### R4. 恢复路径与实时路径分叉
- 策略：统一 replay-first 恢复流程；history 仅作为 fallback。

---

## 7. 建议的实施顺序（架构优先）

1. **契约治理**：补齐 canonical event 版本与字段约束文档。  
2. **投影边界收敛**：清理 projection 中的 UI 偏置字段。  
3. **恢复一致性**：把 gap/restart 统一到 replay-first。  
4. **不变量体系化**：将当前经验性修复沉淀为 invariant + fixture。  
5. **性能治理**：在语义正确性稳定后做批处理与吞吐优化。  

---

## 8. 完成判定（Exit Criteria）

1. 关键语义路径不存在 direct transcript write（仅 canonical -> projection）。  
2. 核心 contract fixture 在 TUI/Web/app-server 侧全部通过。  
3. 典型恢复场景（restart/gap/reconnect）可稳定复现且输出一致。  
4. 新增语义需求可通过“先改 contract -> 后改 adapter/projection”流程落地。  

---

## 9. 与现有文档关系

- 产品边界：`plans/app-server/PRODUCT-SPEC.md`
- 交互合同：`docs/contracts/app-server-interaction-contract.md`
- 接口手册：`docs/references/app-server-api-reference.md`
- UI 规范：`docs/frontend/app-server-ui-spec.md`
- 当前执行清单：`plans/app-server/TODO-INDEX.md`
- 架构路线图（归档）：`plans/_archive/app-server/ARCHITECTURE-ROADMAP.md`

本蓝图用于约束“下一阶段语义架构方向”，不替代上述文档。
