# Permissions Troubleshooting Runbook

本 runbook 用于排查 Formax 的 permissions / policy / approval 行为问题。

规范性事实源见：
- `docs/contracts/permissions-policy-contract.md`
- `docs/contracts/interactive-input-contract.md`

## 1. 先分层

先判断问题属于哪一层：
1. policy 计算层（allow / prompt / deny 是否算错）
2. approval 提交层（用户选择后 payload 或 remember side effects 是否生效）
3. renderer 层（TUI/Web 展示或交互路径是否偏离）

如果 policy 计算已正确，不要先改 UI。

## 2. 常见现象 -> 首查路径

| 现象 | 首查路径 |
|---|---|
| 明明已有 allow 仍反复弹审批 | `src/tools/executor/policyPreflight.ts`、`src/adapters/permissions/matcher.ts`、`src/adapters/permissions/permissionsStore.ts` |
| `approve_remember` 后下一次仍不生效 | `src/tools/executor/approvalService.ts`、`src/core/policy/engine.ts`、`src/adapters/permissions/permissionKeys.ts` |
| `workspace` 目录授权后仍被拦截 | `src/tools/executor/policyPreflight.ts`（workspace boundary）与 `permissions-policy-contract` 的 workspace 条目 |
| TUI / Web 提交结果不一致 | `docs/contracts/interactive-input-contract.md`、`src/app-server/turn/inputStore.ts`、`apps/web-reference-react/src/store.ts` |
| `/permissions` 对话框修改后行为没变 | `src/tui/permissions/PermissionsDialog.tsx`、`src/features/repl/controller/ui/overlays.ts`、settings/rules 落盘路径 |

## 3. 最小排查步骤

1. 确认当前 action 映射是否正确（`ToolCall -> PolicyAction`）。
2. 确认命中规则与优先级（decision、scope、specificity）是否符合预期。
3. 确认 remember 目标是否写到了正确作用域（session/project/global）。
4. 若涉及 app-server/Web，确认 input lifecycle（`input_requested` -> `input_resolved`）没有分叉。

## 4. 最小验证清单

先跑：
1. `bun run test -- src/tools/executor/policyPreflight.test.ts`
2. `bun run test -- src/tools/executor/approvalService.test.ts`
3. `bun run test -- src/tui/permissions/PermissionsDialog.test.tsx`

若涉及 app-server/Web 再补：
4. `bun run test -- src/app-server/turn/inputStore.test.ts src/app-server/server.test.ts`
5. `npm --prefix apps/web-reference-react run test -- src/store.test.ts src/App.test.tsx`

最后：
6. `bun run type-check`

## 5. 红线

1. 不要用 renderer patch 改写 policy 真值。
2. 不要为了“演示通过”放宽权限默认值或 remember scope。
3. 不要在多处重复实现 allow/prompt/deny 规则；保持 policy single owner。
