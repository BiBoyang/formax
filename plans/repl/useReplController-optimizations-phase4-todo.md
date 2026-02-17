# useReplController / 语义化优化 Phase 4 TODO

Status: `completed`  
基线: `plans/repl/useReplController-optimizations-phase4.md`  
目标: 在不改行为前提下，继续下沉 hook 内职责并补强语义契约。

## 约束

- 不引入 `src/features/semantics/index.ts` 统一入口。
- 保持 `xxx/xxx.ts` 命名风格，不回退 `index.ts` 聚合导出。
- 每个 slice 独立提交：`targeted tests + type-check + codex review` 通过后再提交。

## TODO 看板

- [x] P4.2: Turn 完成 session side-effects 下沉到 `controller/session/*`
- [x] P4.3: `resetTranscriptSurface` 事务语义下沉到 `controller/ui/*`
- [x] P4.5: 增加 1-2 个语义契约 fixture（近期踩坑）
- [x] P4.1a: session 持久化签名缓存（同引用消息跳过 stringify）
- [x] P4.1: session 持久化增量化（dirty-id）
- [x] P4.4: canonical transient 最小 setState（按 profiling 决定）
