# TODO：Skills（仅保留 pending）

主线是 `plans/iam/TODO.md`（统一 permissions/审批体系 + `/permissions`）。这里仅记录 skills 还未通过抓包/未落地的部分，避免多 TODO 漂移与重复维护。

## Pending（后置增强）

- [ ] Markdown 渲染（最小）：对 assistant 输出做基础渲染（标题/列表/代码块/强调）

## Notes

- `Skill` 权限语义已落地并由测试覆盖（默认必须审批，allow 后跳过；deny 不弹 UI；approve_remember 落盘并立即生效）。
