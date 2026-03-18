# Web Evidence Workflow

用途：统一 Web 修改（新功能/bugfix）的截图验证证据流程，避免“每次都要 before”或“没有证据留痕”两种极端。

本流程对齐 `harness-engineering-practice/docs/testing/EVIDENCE.md` 的分级策略。

## 证据分级策略

### A 类：可稳定复现的 bug 修复

要求：`before + after`

- `before`：能看到问题存在。
- `after`：能看到问题消失。

示例命令：

```bash
npm --prefix packages/web-reference-react run evidence:after -- --task=TASK-0456-transcript-bug --phase=before
npm --prefix packages/web-reference-react run evidence:after -- --task=TASK-0456-transcript-bug
```

### B 类：新功能开发 / 常规验收

要求：`after` 即可

示例命令：

```bash
npm --prefix packages/web-reference-react run evidence:after -- --task=TASK-0789-thread-panel
```

### C 类：难以稳定复现的问题

要求：`after + 文字说明`（`before` 可省略）

- 截图只保留 `after`。
- 在任务记录中补充“无法稳定复现 before”的原因说明。

## 产物路径

截图默认保存到：

```text
packages/web-reference-react/evidence/tasks/<TASK-ID>/<phase>/<label>-<timestamp>.png
```

说明：

- `<phase>`: `before` 或 `after`
- 默认 label:
  - `before` -> `01-repro`
  - `after` -> `01-acceptance`
- 可通过 `--label=...` 覆盖

## 命令入口

```bash
npm --prefix packages/web-reference-react run evidence:after -- --task=TASK-0123-web-ui
```

可选参数：

- `--task=...`：任务目录名
- `--phase=before|after`：证据阶段（默认 `after`）
- `--label=...`：文件名前缀
- `--scenario=default`：证据场景（当前支持 `default`）
- `--external`：复用已启动 dev server（等价启用 `PLAYWRIGHT_SKIP_WEBSERVER=1`）
