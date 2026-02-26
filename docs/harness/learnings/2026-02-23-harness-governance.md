# Harness Governance 学习记录（2026-02-23）

## 背景

在不重排源码目录的前提下，引入了 Harness 级治理检查。

## 关键决策

1. 通过脚本 + 配置映射，强制执行 `Types -> Config -> Repo -> Service -> Runtime -> UI`。
2. 先冻结当前分层违规为 baseline，仅阻断新增违规。
3. 保持 app-server 通知兼容性（`traceId/eventId` 不变），同时允许可选结构化 `trace` 元数据。
4. 在 chat/executor/hooks/policy/approval 审计事件链路中传递可选 trace 上下文。
5. 保留现有 semantic single-writer 门禁，并收紧为：无架构评审记录时拒绝新增语义写入点文件。

## 运行层影响

- 新增脚本：
  - `check:layer-contracts`
  - `check:golden-principles`
- CI 已加入 `harness-checks` 软门禁（`continue-on-error: true`）。

## 后续动作（切硬门禁）

稳定窗口结束后，在 `.github/workflows/ci.yml` 中移除 `harness-checks` 的 `continue-on-error`。
