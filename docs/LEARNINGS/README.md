# Learnings（知识沉淀）

这里是 Formax 的“可学习性”文档集合：我们通过 **抓包/录屏/对比** 观察到 Claude Code 的行为，然后把结论和 Formax 的落地方式写下来，方便新人或旁观者快速理解。

目标读者：中等技术水平（甚至小白也能跟上）。所以会尽量用“现象 → 证据 → 结论 → 落地 → 验证”的方式写。

## 怎么读

1) 先看 `docs/LEARNINGS/GLOSSARY.md`：术语表（tool_use、tool_result、system-reminder…）
2) 再看 `docs/LEARNINGS/method/README.md`：我们怎么抓包、怎么从证据推导结论
3) 然后按主题阅读：
   - 工具：`docs/LEARNINGS/tools/`
   - 系统提示词/注入：`docs/LEARNINGS/prompts/`
   - UI/交互：`docs/LEARNINGS/ui/`
   - 子任务：`docs/LEARNINGS/subagents/`

## 写作约定（很重要）

为了避免“猜测”被当成“事实”，每篇文章都用这几个标记：

- ✅ **确定（Evidence）**：能在抓包/日志/复现里直接看到
- 🧩 **推断（Inference）**：合理推测，但还没证实
- ❓ **待验证（TODO）**：下一次抓包/复现要重点确认的点
- 🛠 **Formax 落地**：我们在本仓库里怎么实现的（文件/函数/commit）

## 每篇文章建议模板

1) TL;DR（3~5 条）
2) 你在命令行看到什么（小段输出/截图描述）
3) 抓包证据（✅）
4) 我们的推断（🧩，可选）
5) 为什么重要（不对齐会怎样）
6) Formax 如何实现（🛠：文件/关键函数/commit）
7) 怎么验证（3~5 步复现，尽量包含边界）
8) 未解决问题（❓）

## 和其它“知识文件”的关系

- `CODEMAP.md`：给开发者的“去哪改”索引（偏导航）
- `pitfalls.md`：踩坑记录（偏故障/修复）
- `docs/LEARNINGS/`：原理/行为对齐/设计取舍（偏学习）

