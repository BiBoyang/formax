# 测试覆盖率提升 TODO（Vitest）

> 基线（2026-01-27，本机 `npm test -- --coverage`）：
> - Statements: 73.01% (8041 / 11013)
> - Branches: 59.76% (5433 / 9091)
> - Functions: 78.81% (1395 / 1770)

## 环境/配置（可选，但建议）

- [ ] 添加覆盖率门槛：先从 **关键模块** 做 file-level threshold（例如 approvals/policy/handlers），避免“一刀切”导致 CI 噪音
- [ ] 补充 `coverage` include/exclude：确保把纯 demo/示例屏幕与脚手架产物排除在门槛之外（例如 ToolExamplesScreen 这类）

## P2（REPL 交互：快捷键/面板/覆盖 UI 分支）

## P3（网络/执行器：稳定性与复杂分支）

## P4（AgentsDialog：补齐未覆盖分支，保持 UI 文案/键位不变）

> 现状：`src/ui/agents/AgentsDialog.tsx` 仍有大量未覆盖分支（特别是 create flow、advanced tools、磁盘 agents 合并/去重、失败分支）。

- [ ] 扩展 `src/ui/agents/AgentsDialog.test.tsx` / 新增分文件测试：
  - [ ] disk user/project agents 读取后：分组、优先级、去重（project 覆盖 user）、builtin model 显示
  - [ ] create flow：Generate with Claude / Manual 两条路径都覆盖
  - [ ] advanced tools：toggle、group 全选/取消、NON_SELECTABLE_TOOLS 不出现
  - [ ] 保存失败/生成失败：错误提示与返回路径（Esc/Back）稳定
  - [ ] openInEditor 行为与 createdAgents 记录

## P5（CLI：补齐长尾分支）

- [ ] 扩展 `src/cli/main.test.ts`：
  - [ ] `setup` 子命令（成功/失败/usage）
  - [ ] `config migrate`（不同文件存在/缺失、json/human 输出）
  - [ ] `auth`/`config` 未知子命令走 usage
  - [ ] policy disable/delete 的更多边界：ruleId 不存在/仅存在于 project 或 global

## 验收（建议）

- [ ] P0 完成后：至少保证 approvals/policy/plan mode 相关文件达到 **>90% statements** 且分支覆盖有明显提升
- [ ] 每做完一个模块：跑一次单文件 coverage + 全量 coverage，确认没有把 UI 文案/交互键位改掉

## 常用命令（备忘）

- 全量覆盖率：`npm run test:coverage`（或 `bun run test:coverage`）
- 单文件覆盖率：`npx vitest run --coverage src/ui/permissions/PermissionsDialog.test.tsx`
- HTML 报告：`coverage/index.html`
