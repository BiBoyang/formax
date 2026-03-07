# Docs（入口）

`docs/` 是 Formax 仓库内长期文档知识的系统事实源目录。

本文件只做 docs 入口，不维护完整目录、不承载规范正文。

请按以下顺序进入：

1. 先读 `docs/index.md`，按任务类型找到对应 canonical doc。
2. 只有在任务直接涉及运行时配置或环境变量时，再进入 `docs/environment-variables.md`。

职责边界：

- `docs/README.md`：轻量入口，告诉读者先去哪里找。
- `docs/index.md`：`docs/` 内部总索引，维护各类文档的职责与 canonical 落点。
- `docs/*` 子文档：承载具体 contract / runbook / reference / design / learning / pitfall 内容。

当前目录结构已按主题拆分到子目录：
`contracts/`、`references/`、`frontend/`、`runbooks/`、`design/`、`audits/`、`baselines/`、`learnings/`、`inventories/`、`pitfalls/`。
