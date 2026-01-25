# Hooks（Claude Code 风格）集成 TODO（Phase 1，已完成）

这份文件是 `plans/hooks/TODO.md` 的归档版本：Phase 1（`PreToolUse / PermissionRequest / PostToolUse`）已完成，因此把完成清单移到这里，避免干扰后续开发。

如需回看 Phase 1 的设计与约束，请参考：
- `plans/hooks/hooks.md`
- `plans/hooks/hook-guide.md`
- `plans/_archive/hooks/PHASE1-SEQUENCE.md`

---

（以下为 Phase 1 原 TODO 内容备份）

目标：在 Formax 中集成 Claude Code hooks 的最小可用底座，优先覆盖 `PreToolUse / PermissionRequest / PostToolUse`，并按抓包对齐 `PostToolUse.additionalContext` 的注入行为。

范围约束（Phase 1）：
- 只做 `type: command`（跑本地命令）
- 不做 `/hooks` UI，不做 plugins，不做 SessionStart/Stop/UserPromptSubmit 等扩展事件（后置）
- 不引入 system-reminder “体系工程”，但 **允许**按 Claude Code 抓包结果使用 `<system-reminder>...</system-reminder>` 作为 *hook 注入的容器文本*

关键事实（来自本地抓包）：
- Claude Code 的 `PostToolUse.additionalContext` 会被转换成 `<system-reminder>` 注入到后续模型调用（同一轮 tool loop 内即可生效）。
- 注入位置存在两种变体：
  - 作为 `tool_result` 同一个 content string 的尾部拼接
  - 作为紧跟 `tool_result` 的 `text` content block
- Phase 1 固定实现为：**紧跟的 text content block**。

## 完成项（Phase 1）

- [x] H0：对齐目标锁定（注入位置/文案风格）
- [x] H1：Hooks 配置读取与三层合并（.formax）
- [x] H2：Hook runner（并发 + timeout + stdout/stderr + exit code 语义）
- [x] H3：PreToolUse 接入（工具执行前）
- [x] H4：PermissionRequest 接入（审批 UI 之前）
- [x] H5：PostToolUse 接入（工具执行后 + 下一轮注入）
- [x] H6：测试与回滚（单测/集成/审计字段/回滚开关）

