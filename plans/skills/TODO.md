# TODO：Skills（仅保留 pending）

主线是 `plans/iam/TODO.md`（统一 permissions/审批体系 + `/permissions`）。这里仅记录 skills 还未通过抓包/未落地的部分，避免多 TODO 漂移与重复维护。

## Pending（需抓包确认）

- [ ] 首次触发 skill → 弹框 → 选 2 → 写入 `<projectRoot>/.formax/settings.local.json` → 再触发不弹
- [ ] 删除 allow → 不重启 → 再触发应重新弹
- [ ] 抓包确认 allow/deny 后的请求是否出现可观测差异（例如 tool list / system 注入 / 额外标记）

## Pending（后置增强）

- [ ] Markdown 渲染（最小）：对 assistant 输出做基础渲染（标题/列表/代码块/强调）

## Notes

- skills 相关的抓包材料/截图/实验记录属于“证据”，建议放到 `plans/_archive/skills/`，避免主线 TODO 混入大量历史细节。
