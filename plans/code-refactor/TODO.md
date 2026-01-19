# TODO：Code Refactor（仅保留 pending，当前暂停）

这条线是“结构性整理”（/commands + skills + /agents + 契约层/overlay）。目前主线在 `plans/iam/TODO.md`（权限/审批基座），因此这里仅保留 **未来继续推进时还没做/没定稿** 的事项，避免文档过长与重复维护。

## Pending（等 IAM 稳定后再继续）

- [ ] **invokables 统一**：把 skills + custom file commands 合并成一份“可注入列表”（供 `Skill` tool description 注入/未来 skills 机制使用）
  - [ ] 统一 `InvokableMeta`（name/description/argumentHint/disableModelInvocation/sourcePath）
  - [ ] 规则定稿：无 `description` 的 command 是否进入列表（严格只允许 frontmatter vs fallback 首行）
  - [ ] 预算裁剪规则稳定（同输入同输出；默认 budget 需确认）
- [ ] **Skill tool 与 custom commands 的关系**（如果要做）
  - [ ] 是否把 custom file commands 也合并进 `Skill` tool 的 `<available_skills>`（Claude Code 风格）
  - [ ] 若合并：`/` 开头是否作为 file command invoke（复用 CommandStore + render）
- [ ] **边界固化**（防止回归）
  - [ ] runtime 代码禁止出现 `.claude/`（加到 boundary checks / type-check）

## Pending（手动回归清单）

- [ ] `/agents`、`/todos`、`/doctor`、普通对话与工具调用：行为不回归

## Notes

- 更细的目录树/接口签名/迁移策略留在历史文档里（`plans/code-refactor/webgpt*.md`），不再在本 TODO 里重复。
