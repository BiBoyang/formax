# Context Compression Pause State (2026-05-16)

目标：把当前上下文压缩主线收口到一个可暂停、可恢复的状态，避免后续恢复时重新做差距判断或误开新主线。

## 当前是否适合暂停

适合，现在就是一个安全停点。

原因：

1. `CCA-170` / `CCA-171` / `CCA-172` 已全部完成。
2. post-`CCA-172` mainline re-rank 已完成，18x 只是计划状态，还没有半做的 runtime 改动。
3. 工作区应保持干净；当前没有需要继续收口的未提交代码。
4. canonical contract、rolling plan、gap snapshot 已同步到同一状态。

换句话说，当前不是“做到一半的系统骨架”，而是：

> 17x 波段已收口，18x 波段尚未开工。

## 当前剩余差距怎么分层

### 仍然算系统级残差

1. `CCA-180` deferred-task restore utility v7
2. `CCA-181` preserved-segment relink parity

这两条不是 trivial。

- `CCA-180` 关注的是 restore 后如何保住更高阶任务连续性：
  - deferred tool exposure / prompt-variant continuity
  - bounded async-agent / delegated-task continuity
  - deferred instructions continuity
- `CCA-181` 关注的是 compact protocol 的 preserved segment 从“已有 metadata”推进到“更可靠的 relink / validation parity”。

### 属于成熟度补强

1. `CCA-182` reactive compact shaping v3
2. 后续可选的 `microcompact` 成熟化
3. 更深的 diagnostics / inspection control-plane

这些都不是新的骨架设计，而是已有子系统继续长成。

### 属于战术 / 兼容 / 文档补件

1. parser / cache parity 零碎残差
2. schema backward compatibility
3. rolling plan / gap narrative 漂移修正
4. 局部旧技术债，例如 Web 的 `navigator.userAgentData` typing 问题

这些不该再主导主线。

## 剩余工作量估算

这里按“一个小的、可验证、可提交的 loop”估算，而不是按抽象人天。

### 如果只做系统级残差

#### `CCA-180` deferred-task restore utility v7

预估：`1 ~ 2` 个 loop

原因：

1. canonical restore-artifacts 路径已经存在。
2. `pendingSessionMemoryRestore`、`thread/resume`、`thread/replay`、Web parser 都已经有前置模式。
3. 这轮主要是 bounded utility shape 扩展，不应引入新的 persisted authority。

预计触达：

1. `packages/core/src/chat/context/sessionMemory.ts`
2. `packages/core/src/features/repl/sessionSave/sessionMemoryRefresh.ts`
3. `packages/core/src/app-server/threadStore.ts`
4. `packages/core/src/app-server/server.ts`
5. `packages/web-reference-react/src/app/core/rpcContracts.ts`
6. `packages/web-reference-react/src/app/core/rpcParsers.ts`
7. `docs/contracts/session-persistence-contract.md`
8. `docs/contracts/prompt-tool-exposure-contract.md`
9. `docs/contracts/app-server-interaction-contract.md`

#### `CCA-181` preserved-segment relink parity

预估：`2 ~ 3` 个 loop

原因：

1. 这条线会碰 compact protocol 语义，不只是多加字段。
2. 需要同时考虑 replay / resume / inspection 的 validation parity。
3. 很容易做出“看起来对了，但只是 surface 补件”的假闭环，所以需要更严格的 contract + tests。

预计触达：

1. `packages/core/src/chat/context/compact.ts`
2. `packages/core/src/chat/context/contextDiagnostics.ts`
3. `packages/core/src/app-server/threadStore.ts`
4. `packages/core/src/app-server/server.ts`
5. `packages/web-reference-react/src/app/core/rpcContracts.ts`
6. `packages/web-reference-react/src/app/core/rpcParsers.ts`
7. `docs/contracts/session-persistence-contract.md`
8. `docs/contracts/app-server-interaction-contract.md`
9. `packages/core/src/chat/context/README.md`

#### 系统级残差合计

预估：`3 ~ 5` 个 loop

这是“处理到一个我认为后半段主线已经进入自然暂停位”的最低剩余工作量。

### 如果连成熟度补强也一起做

#### `CCA-182` reactive compact shaping v3

预估：`1 ~ 2` 个 loop

主要工作：

1. provider-specific shaping
2. richer overflow classification / telemetry
3. 与现有 middle-layer facts 更深联动

#### 可选后续成熟化

预估：`2 ~ 4` 个 loop

可能包含：

1. `microcompact` 覆盖度继续补强
2. richer diagnostics / inspection control-plane
3. 额外 parity / compatibility cleanup

#### 系统级残差 + 成熟度补强合计

预估：`6 ~ 11` 个 loop

这个量级已经不适合“顺手做完再停”。继续推下去，很容易重新掉回无边界优化。

## 推荐暂停点

推荐暂停点就是**现在**，不要继续把 18x 开工。

原因：

1. 当前已经完成了一个完整波段，主线切换点清晰。
2. 18x 还没开始，不存在“做一半挂着”的实现债。
3. 如果继续往下做，最少也要再走 `3 ~ 5` 个 loop 才能把系统级残差收口到下一个自然停点。

所以更合理的判断是：

> 现在暂停，工程风险最低，恢复成本也最低。

## 恢复时的唯一推荐顺序

恢复后，按这个顺序继续：

1. `CCA-180` deferred-task restore utility v7
2. `CCA-181` preserved-segment relink parity
3. `CCA-182` reactive compact shaping v3

不要恢复后重排成别的方向，除非先重新做一次 mainline re-rank。

## 恢复时不要先做的事

恢复后不要先开这些项：

1. 新的 query-time reducer
2. 完整 persisted collapse store
3. archived collapse spans / collapse commits
4. replay-time collapse projection rebuild
5. 纯 surface 漂亮化的 diagnostics UI 扩张

理由：

1. 这些要么不是当前最大差距，
2. 要么会把主线重新拖回无底洞。

## 恢复时的最短检查单

恢复这条主线前，先做这 5 步：

1. 读本文件。
2. 读 [README.md](./README.md)。
3. 读 [NEXT-TODO-2026-04-07.md](./NEXT-TODO-2026-04-07.md)。
4. 读 [CLAUDE-CODE-GAP-SNAPSHOT-2026-04-06.md](./CLAUDE-CODE-GAP-SNAPSHOT-2026-04-06.md)。
5. 从 `CCA-180` 开始，不要跳号开工。

## 一句话结论

当前上下文压缩主线已经处在一个**适合暂停**的位置。

- 如果只是想把系统停在安全点：现在就可以停。
- 如果要把“后半段系统残差”也一起做完：至少还需要 `3 ~ 5` 个 loop。
- 如果连成熟度补强也想一起做：大约还需要 `6 ~ 11` 个 loop。

当前推荐动作不是继续开工，而是：

> 保持暂停状态；下次恢复时从 `CCA-180` 开始。
