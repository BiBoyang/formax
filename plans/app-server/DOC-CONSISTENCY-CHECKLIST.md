# App Server 文档一致性检查（v2）

用途：验证 Product / Contract / UI / API 四份文档命名一致，避免字段漂移。

## 核心字段对齐

| 主题 | Product | Contract | UI | API | 结论 |
|---|---|---|---|---|---|
| 输入类型 | `approval` / `ask_user_question` | `InputKind` | pending input 双表单 | Input payload 两种结构 | 一致 |
| input 状态 | `pending -> submitted/canceled/expired/failed` | `InputStatus` / 状态机 | Pending + stale 展示 | `InputResolvedPayload.status` | 一致 |
| turn 终态 | `completed/failed/interrupted` | Turn 状态机 | interrupt + completed/failed 可见 | `turn/completed` / `turn/failed` | 一致 |
| envelope 元字段 | 提到稳定协议 | `traceId/seq/ts/eventId/source` | transcript/system logs 依赖 | 通知 envelope 说明 | 一致 |
| 错误码 | Recoverable Failure 原则 | 固定错误码 + typed data | 错误抽屉显示 code/message/data | JSON-RPC error model | 一致 |
| commander 子集 | P1: slash 子集 | 不改协议 | `/permissions` `/agents` `/hooks` | 通过 `turn/start` 文本路径 | 一致 |

## 结论

- 新成员按以下顺序阅读即可描述闭环：
  1. `plans/app-server/PRODUCT-SPEC.md`
  2. `plans/app-server/INTERACTION-CONTRACT.md`
  3. `plans/app-server/UI-SPEC.md`
  4. `plans/app-server/API-REFERENCE.md`
- 本次检查未发现字段命名冲突。
