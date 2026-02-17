# TODO Next：Semantics Single-Writer（from Roadmap + Blueprint）

更新时间：2026-02-17
来源：
- `plans/app-server/ARCHITECTURE-ROADMAP.md`
- `plans/app-server/SEMANTICS-ARCHITECTURE-BLUEPRINT.md`

> 本清单用于下一阶段主线推进。旧 `plans/app-server/TODO.md` 视为历史执行记录，不再作为主线来源。

## P0b：Contract Governance + Single Writer

- [x] N1 Canonical envelope 版本治理（schema version + 字段约束）
  - 目标：明确 canonical event 版本边界，禁止“静默漂移”。
  - 验收：
    - core 提供 canonical schema version 常量与校验入口。
    - app-server 路径的 notification/replay 入口对非法版本做显式拒绝或诊断标记。
    - Contract/API 文档写明版本兼容策略（向后兼容扩展 vs 破坏性升级）。

- [ ] N2 adapter 单点化（notification/stream/replay mapping 不再多端平行实现）
  - 目标：同一类输入事件到 canonical 的映射规则只保留一份。
  - 验收：
    - Web/TUI/app-server 不再维护重复 mapping 分支。
    - 同一 fixture 在 3 个入口映射结果一致（忽略渲染差异）。

- [ ] N3 TUI 语义单写入源（去掉 turn 内 direct transcript write）
  - 目标：turn 进行中仅 canonical -> projection 产出 transcript，legacy 仅保留 UI-only 细节通道。
  - 验收：
    - turn 内 assistant/thinking/tool 行不再由 legacy 分支直接写入 `messages`。
    - 现有 duplicated tool row / late delta 回写类回归测试仍通过。

- [ ] N4 Realtime = Replay 一致性门禁
  - 目标：实时消费与重放恢复对同一事件序列输出同构语义结果。
  - 验收：
    - 新增跨端 fixture：realtime 结果与 replay 重建结果一致。
    - `hasGap=true` 路径只走 replay-first 重建，不回退历史拼接。

- [ ] N5 不变量体系化（防补丁回归）
  - 目标：把经验修复沉淀为 invariant，而不是继续“case by case”补丁。
  - 验收（至少）：
    - 同一 turn 内 `toolUseId` 最终行唯一。
    - turn 终局后无 running tool。
    - pending input 必有终局。
    - replaySeq 单调与幂等去重保持成立。

## P1：Projection/Renderer 长期解耦

- [ ] N6 projection 状态去 UI 偏置
  - 目标：projection 仅保留语义状态，不携带 renderer 偏好。
  - 验收：
    - UI 派生逻辑下沉到 selector 层。
    - projection reducer 不再因 TUI/Web 展示差异产生分支。

- [ ] N7 selector 层稳定接口
  - 目标：为 TUI/Web 提供统一 view-model 入口，限制渲染层直接访问原始语义细节。
  - 验收：
    - 新增 selector API（最小集合）并被两端消费。
    - renderer 仅处理展示，不做语义纠偏。

## 本轮执行策略

1. 每次只做一个编号项的小切片（2-6 文件为宜）。
2. 每个切片流程固定：实现 -> 定向测试 -> `codex review` -> 提交。
3. 优先完成 P0b（N1-N5），再进入 P1。
