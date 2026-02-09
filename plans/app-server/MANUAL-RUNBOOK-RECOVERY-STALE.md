# Manual Runbook: Recovery / Stale Input

用途：记录“重启恢复 + stale input 提交失败”人工验收证据。

环境信息：

- 日期：
- 执行人：
- branch / commit：

## A. 重启恢复流程

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

## B. stale input 提交失败

针对 `staleInputs` 中任意一条执行 `turn/input/submit`：

| inputId | 预期错误 | 实际错误 code/message/data.kind | 是否通过 |
|---|---|---|---|
|  | `INPUT_EXPIRED` |  |  |

## C. interrupt/completed/failed 收敛

| 场景 | 预期 | 实际 | 是否通过 |
|---|---|---|---|
| turn interrupt 后 pending 收敛 | canceled/failed，不残留 pending |  |  |
| turn completed 后 pending 收敛 | submitted 或 resolved，不残留 pending |  |  |
| turn failed 后 pending 收敛 | failed/expired，不残留 pending |  |  |

## D. 判定

- [ ] resume 可恢复 thread 并返回 staleInputs
- [ ] stale input 提交必定失败（typed 错误可识别）
- [ ] 异常路径不产生 pending 泄漏
