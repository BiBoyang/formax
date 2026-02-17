# Manual Runbook

用途：记录 app-server 主线人工验收证据（Thread/Turn/Input 闭环 + Recovery/Stale）。

环境信息：

- 日期：
- 执行人：
- branch / commit：
- bridge URL：
- UI URL：

## Part A. Thread / Turn / Input Loop

### A1. Thread/Turn 闭环（20 次）

| # | threadId | turnId | 输入摘要 | 结果（completed/failed） | 关键日志 | 备注 |
|---|---|---|---|---|---|---|
| 1 |  |  |  |  |  |  |
| 2 |  |  |  |  |  |  |
| 3 |  |  |  |  |  |  |
| 4 |  |  |  |  |  |  |
| 5 |  |  |  |  |  |  |
| 6 |  |  |  |  |  |  |
| 7 |  |  |  |  |  |  |
| 8 |  |  |  |  |  |  |
| 9 |  |  |  |  |  |  |
| 10 |  |  |  |  |  |  |
| 11 |  |  |  |  |  |  |
| 12 |  |  |  |  |  |  |
| 13 |  |  |  |  |  |  |
| 14 |  |  |  |  |  |  |
| 15 |  |  |  |  |  |  |
| 16 |  |  |  |  |  |  |
| 17 |  |  |  |  |  |  |
| 18 |  |  |  |  |  |  |
| 19 |  |  |  |  |  |  |
| 20 |  |  |  |  |  |  |

### A2. Approval 闭环（10 次）

| # | threadId | turnId | inputId | 决策 | submit 状态 | turn 是否继续 | 备注 |
|---|---|---|---|---|---|---|---|
| 1 |  |  |  |  |  |  |  |
| 2 |  |  |  |  |  |  |  |
| 3 |  |  |  |  |  |  |  |
| 4 |  |  |  |  |  |  |  |
| 5 |  |  |  |  |  |  |  |
| 6 |  |  |  |  |  |  |  |
| 7 |  |  |  |  |  |  |  |
| 8 |  |  |  |  |  |  |  |
| 9 |  |  |  |  |  |  |  |
| 10 |  |  |  |  |  |  |  |

### A3. AskUserQuestion 闭环（10 次）

| # | threadId | turnId | inputId | 回答摘要 | submit 状态 | turn 是否继续 | 备注 |
|---|---|---|---|---|---|---|---|
| 1 |  |  |  |  |  |  |  |
| 2 |  |  |  |  |  |  |  |
| 3 |  |  |  |  |  |  |  |
| 4 |  |  |  |  |  |  |  |
| 5 |  |  |  |  |  |  |  |
| 6 |  |  |  |  |  |  |  |
| 7 |  |  |  |  |  |  |  |
| 8 |  |  |  |  |  |  |  |
| 9 |  |  |  |  |  |  |  |
| 10 |  |  |  |  |  |  |  |

### A4. 判定

- [ ] Thread/Turn 20 次闭环通过
- [ ] Approval 10 次闭环通过
- [ ] AskUserQuestion 10 次闭环通过
- [ ] 无 unresolved pending input 残留

## Part B. Recovery / Stale Input

### B1. 重启恢复流程

1. 创建 thread 并发起 turn，确保触发至少 1 个 pending input。
2. 在 input 未提交前重启 app-server。
3. 重新连接后调用 `thread/resume`。
4. 记录 `staleInputs` 返回与 UI 展示。

| 步骤 | 观察结果 | 是否符合预期 |
|---|---|---|
| 重启前存在 pending input |  |  |
| resume 返回 staleInputs |  |  |
| stale input 状态为 expired |  |  |
| UI 标注不可继续提交 |  |  |

### B2. stale input 提交失败

针对 `staleInputs` 中任意一条执行 `turn/input/submit`：

| inputId | 预期错误 | 实际错误 code/message/data.kind | 是否通过 |
|---|---|---|---|
|  | `INPUT_EXPIRED` |  |  |

### B3. interrupt/completed/failed 收敛

| 场景 | 预期 | 实际 | 是否通过 |
|---|---|---|---|
| turn interrupt 后 pending 收敛 | canceled/failed，不残留 pending |  |  |
| turn completed 后 pending 收敛 | submitted 或 resolved，不残留 pending |  |  |
| turn failed 后 pending 收敛 | failed/expired，不残留 pending |  |  |

### B4. 判定

- [ ] resume 可恢复 thread 并返回 staleInputs
- [ ] stale input 提交必定失败（typed 错误可识别）
- [ ] 异常路径不产生 pending 泄漏
