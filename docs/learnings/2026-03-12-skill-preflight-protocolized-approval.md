# 2026-03-12 Skill Preflight Protocolized Approval

## 背景

`Skill` preflight 之前属于 approval-like 但 out-of-band 的交互路径：会直接调用 `requestAnswers`，却不发 `approval_request`，导致 app-server / Web 看不到 canonical pending input 生命周期。

## 决策

将 `Skill` preflight 对齐到 canonical 输入协议：

1. 需要人工确认时发出 `approval_request`
2. payload 采用 `toolName='Skill'` 与 `action.kind='skill.use'`
3. 继续使用既有 `requestAnswers` 阻塞语义，保持 TUI 行为

同时对 Web approval UI 增加规则：`skill.use`（或 `toolName='Skill'`）走单步 remember，不进入 scope 步骤。

## 结果

1. `Skill` 进入 `turn/inputRequested` -> `turn/inputResolved` 的统一生命周期
2. GUI/TUI 在 “Skill 需要审批” 场景下共享同一协议入口，不再依赖 out-of-band 特例
3. `Skill` 的 remember 语义保持不变（仍写 repo-local allow）
