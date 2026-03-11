# 2026-03-12 app-server planPath parity

## 背景

GUI（app-server 路径）在 plan mode 中出现 `AskUserQuestion` 后继续 `Write/Edit` 计划文件时报错，错误表现为“Plan mode is active. Only the plan file may be edited.”。  
根因是 app-server `TurnRunner` 在 plan turn 中传给 `buildTurnInput` 与 `exec` 的 `planPath` 为 `null`，导致 policy preflight 无法识别合法计划文件写入。

## 决策

将 app-server 的 plan 文件上下文对齐到 TUI 语义：

1. 当 `turn/start` 进入 `mode="plan"` 时，为 thread 建立并缓存 plan session（基于 runtime `paths.planDir`）。
2. 为 plan turn 生成/复用稳定 `planPath`，并注入到：
   - `buildTurnInput(..., planPath)`
   - engine `exec.getPlanPath/exec.planPath`
3. 同一 thread 的多个 plan turn 复用同一 `planPath`，避免模型在同一 planning 会话中漂移到非白名单文件。

## 防回归点

1. app-server plan turn 的 `exec.getPlanPath` 返回非空路径，且路径文件真实存在。
2. 同一 thread 连续两个 plan turn 获取到相同的 plan path。
