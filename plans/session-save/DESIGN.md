# Formax 会话持久化（Session Save）设计草案（参考 Codex）

目标：让用户**随时关闭/重开** Formax 都能**无缝续接**当前工作，不再“因为怕丢上下文而不敢退出”。

> 说明：本设计是“先把保存/恢复跑通并稳定”的 Phase 1；每个开关对真实功能生效（Phase 2）可以后置。  
> Codex 参考实现要点：JSONL + append-only + meta-first + resume picker。

---

## 1. 用户痛点与目标（What / Why）

### 1.1 要解决的痛点
- 长任务进行中，用户不敢关闭窗口/应用；一旦关闭就丢历史、丢上下文、丢进度。
- 出现崩溃/升级/重启后，无法恢复到“继续做刚才那个任务”的状态。
- 想把一段 session 作为“可回放/可审计”的记录（排查问题、回看思路）。

### 1.2 Phase 1 的明确目标（MVP）
- **自动保存**：对话过程中增量写入到磁盘（不靠退出时一次性 dump）。
- **可恢复**：重启后能恢复：
  - UI transcript（用户/助手/工具消息、命令子行等）
  - LLM 侧将继续使用的“对话历史”（用于下一次请求的 messages）
  - 最关键的“任务状态线索”（例如：已 compact、已 clear、是否存在 Expanded Transcript 等）
- **安全可控**：用户能关闭此功能；能删除/导出；默认权限严格。

### 1.3 非目标（先不做）
- 云同步、多设备同步
- 复杂的增量压缩/加密/全文检索（可以预留接口）
- “完全复刻 CC 的所有隐藏字段/内部结构”

---

## 2. 需要保存哪些内容（Data to persist）

Formax 目前至少有两套“需要持久化的视图”：

1) **UI transcript（Msg[]）**  
用于恢复用户看到的对话流（包括 tool UI、command_subline、thinking_block 等）。

2) **模型上下文（ChatHistory = PromptMessage[]）**  
用于恢复下一轮请求所用的 messages（这决定“续接任务”是否真的连续）。

> 关键工程点：`ChatHistory` 不是“只追加不修改”。在真实运行中它会被 `prune`（裁剪）、`/compact`（重建）、以及各种“turn 结束时的收敛逻辑”影响。
> 因此落盘不能仅靠“history_msg 逐条 append”就假设能还原；Phase 1 应该以 **turn-level snapshot** 作为真源（见第 4 节）。

除此之外（可选/建议）：
- **会话元信息**：session id、创建时间、cwd/projectRoot、版本号、模型信息、是否 ephemeral 等
- **重要事件**：`/compact`、`/clear`、`/config` 修改（至少用于审计/恢复提示）
- **注入块（Injected Blocks）**：
  - Phase 1 策略：**默认不保存“注入后的最终文本”**（恢复时重算），但要保存“注入发生了什么/来源是什么/是否截断”等事件用于审计与 debug。
  - 为了避免“一刀切”导致成本/隐私/可回放目标互相冲突，我们把 injected blocks 分三类（Phase 1 先做元信息落盘；Phase 2 再讨论是否需要“完全一致回放”）：
    - A. **纯 UI/本地信息注入**（例如：`<local-command-stdout>`、command_subline 等）
      - 落盘：主要依赖 `Msg[]`（UI transcript）即可；如需审计，记录一个简短 event（command 名称/长度/是否截断）。
      - 恢复：从 session 文件回放 `Msg[]`，无需重算注入文本。
    - B. **模型行为强相关，但可重算且可控体积**（例如：`outputStyle`、`STATUS` 这类短注入）
      - 落盘：记录 event（启用/值/版本/当时的长度/是否截断）。
      - 恢复：按当前配置重算注入文本（保证行为一致；不追求“文本字节级一致”）。
    - C. **体积/隐私风险最大，且内容来自磁盘**（例如：project/user `CLAUDE.md`）
      - 落盘：不保存全文；仅保存 `{ path, mtime?, size, hash?（可选）, truncated? }`。
      - 恢复：读取当前磁盘内容并重算注入文本（并应用统一 cap）。

---

## 3. 存储位置与文件结构（Storage layout）

参考 Codex 的可运维性（按日期分层、JSONL、append-only），建议：

### 3.1 根目录（Global）
放在用户级目录下的 `~/.formax/`（现有默认 `FORMAX_CONFIG_DIR` 即是这个方向）。

```
~/.formax/
  sessions/
    YYYY/
      MM/
        DD/
          session-YYYY-MM-DDThh-mm-ss-<sessionId>.jsonl
    session_index.jsonl        # 可选：快速 name/id 映射与最近更新时间（append-only）
  history.jsonl                 # 可选：轻量“用户输入历史”，用于输入补全/搜索（append-only）
  archived_sessions/            # 可选：归档（移动旧会话）
```

说明：**不引入项目级 `.formax/sessions/`**。Phase 1 仅做 **global sessions**，并在 `/resume`（或 resume-last）里默认按当前 `cwd` 过滤显示（类似 Codex picker）。

---

## 4. 文件格式（JSONL schema）

### 4.1 为什么用 JSONL（而不是一个大 JSON）
- 崩溃/强杀时：最多丢最后一行（可忽略/跳过坏行），不会整个文件坏掉。
- 追加写更简单，不需要“读-改-写”大文件。
- 便于审计与调试（`tail -f` / `jq` / grep）。

### 4.2 “Meta-first line”策略
借鉴 Codex：第一行必须是 meta，后续全是事件/消息。

建议行结构：

```jsonc
{"type":"session_meta","v":1,"id":"...","createdAt":"...","cwd":"...","projectRoot":"...","appVersion":"...","model":"..."}
{"type":"ui_msg","msg":{ /* Msg */ }}
{"type":"history_msg","msg":{ /* PromptMessage */ }}
{"type":"event","name":"compact","data":{...}}
```

补充：为了保证 `ChatHistory` 的“可还原语义”，Phase 1 建议加入一个明确的快照记录类型（turn-level）：

```jsonc
{"type":"history_state","v":1,"seq":123,"messages":[ /* PromptMessage[] */ ],"truncated":false}
```

- `seq`：单调递增的序号（写入顺序一致，便于 reader 选择“最后一套完整状态”）
- `messages`：写入 **当时内存中的最终 `historyRef.current`**（即下一次请求会用的 messages）
- `truncated`：若触发单行/单 session 上限导致快照被裁剪，则标记并在恢复时提示（避免“悄悄改变行为”）

**关键点**
- `type` + `v`：为未来 schema 迁移留空间
- 每行必须独立可解析；解析失败则跳过该行（并计数 parseErrors）
- 需要限制单行大小（避免把超大 tool 输出写爆）：Phase 1 先定一个默认值 `maxLineBytes = 1 MiB`（1,048,576 bytes），超出则截断并标记 `truncated: true`（后续如遇真实场景再调参）

---

## 5. 写入策略（Durability & performance）

### 5.1 写入时机
Phase 1 建议做到“关键点增量写入”：
- 用户发送（User submit）→ 记录 user Msg + history message
- LLM 产出 assistant 消息（包括 streaming 完成后）→ 记录 assistant Msg + history message
- Tool call / tool result 完成后 → 记录 tool Msg（包含结果摘要/必要字段）
- `/compact`、`/clear`、`/config` 退出时（commit changes）→ 记录 event + 必要的 Msg/command_subline

### 5.1.1 “稳定态”写入规则（避免 streaming/transient 污染）
为了避免恢复时出现重复消息、或卡在 `running`/`isStreaming` 的半成品状态，Phase 1 建议：
- UI transcript（`Msg[]`）只持久化 **稳定态**：
  - assistant：streaming 结束后的最终消息
  - tool：`completed` / `error`（不落 `running`）
  - overlay：dismiss 子行等一次性输出
- 如确需记录中间态（后置）：用 `ui_msg_patch`（按 `id` upsert）而不是 append 多条。
并且遵循一句话原则：**落盘写“最终结果”，不写“过程帧”；过程帧只用 event 记录关键节点。**

### 5.2 Writer 线程/队列（参考 Codex recorder）
不要在 UI/render 热路径做同步 I/O。建议：
- 用一个 `SessionWriter`（单例/每 session 一个）：
  - 内部有一个 bounded queue（防止无限堆积）
  - 后台顺序写入 file handle（append）
  - 每次写后 `flush`（以及可选的 `fsync`）

### 5.3 权限与安全
- 文件权限尽量 `0600`（用户可读写，其他人不可读）
- 默认不把 session 文件放进 repo，也不进入任何上传流程

---

## 6. 恢复机制（Resume）

### 6.1 如何选择“恢复哪个 session”
建议提供三种入口（参考 Codex，但先不追求 UI 完整一致）：
- `formax --resume-last`：恢复当前 cwd 下最新 session
- `formax --resume-picker`：交互式 picker（可后置）
- REPL 内 `/resume`：显示最近 sessions 列表并选择（可后置）

默认行为建议：
- “当前 cwd 过滤”是默认（减少噪音）；提供 `--all` 显示全部。

### 6.1.1 cwd 匹配的工程定义（避免“找不到 session”）
为了避免 symlink/大小写/monorepo 子目录导致的匹配失败，建议在 meta 里同时存：
- `cwd`：原始 `process.cwd()`
- `cwdReal`：`realpath(cwd)`（best-effort）
- `projectRoot`：如果可计算（best-effort）

默认过滤按 `cwdReal` 匹配（取不到则退回 `cwd`），并在文档里明确这一点。

### 6.2 恢复时要重建什么
最小需要：
- UI messages（`Msg[]`）恢复到 transcript
- `historyRef.current`（`ChatHistory`）恢复到下一次请求的 messages
- 恢复一些会影响 UI 的状态（例如 expanded transcript 是否打开，或至少恢复到关闭态）

建议将“恢复”实现为：**解析 JSONL → 重放/合并成内存状态**  
（类似 Codex “rollout replay”，我们不必照抄其 item 类型，但要有“从事件恢复状态”的思路）

对于 `ChatHistory`，reader 应以 **最后一条 `history_state`** 为准（如不存在则用 history_msg 回放兜底）。这样能保证恢复后的 history 与当时 “turn 结束后的最终 historyRef.current” 一致。

### 6.3 `/clear` 的建议语义（对齐 Claude Code）
你最新测试的 CC 行为很关键：`/clear` **并不是“在同一个 session 里清屏”**，而是：
- **切换到一个新的 session id**（相当于 “start fresh thread”）
- 旧 session 仍然存在，可通过 `/resume`（session 列表）找回继续

因此为了对齐，我们应该把 `/clear` 设计成：
- 结束当前 session（写入 `event: clear` + flush）
- 立即创建并切换到新 session（新的 session id / 新的 session 文件）
- UI 上表现为：可见 transcript 清空、模型上下文也重置（相当于新对话）

这会让“清屏”和“上下文断开”统一且可解释，也能避免用户误以为“清屏但模型还记得”。

实现提示（Phase 1 设计层面）：
- 旧 session 不需要特殊 “archive” 动作：只要它已经增量落盘，就天然可恢复
- `/resume` 默认按 cwd 过滤（减少噪音），支持 `--all` 查看全部（类似 Codex）

---

## 7. 隐私/可控性（Privacy & user control）

必须提供（Phase 1 里至少要有开关 + 删除）：
- 全局开关：是否启用 session persistence（例如 `FORMAX_SESSION_SAVE=0` 或在 `/config` 里）
- 清理能力：
  - 删除当前 session
  - 删除全部 sessions（或按项目删除）
- 导出能力（后置也可以）：把一个 session 打包成 zip/tar（用于 debug bundle）

建议（后置）：
- 内容裁剪/脱敏策略（例如：对 `FORMAX_API_KEY` 模式的字符串做 redaction）

---

## 8. 保留策略（Retention）

为了对齐 Codex（你已观察到单个 session 文件可能超过 1GB），Phase 1 默认策略是：
- **不设置单 session 文件大小上限**（不做 `maxSessionBytes` 限制）
- 只设置 **单条记录/单行上限**（`maxLineBytes`，Phase 1 默认 `1 MiB`），避免极端大单行导致 JSONL 不可读/不可传/不可解析
- 如用户担心占用磁盘：提供显式删除/清理入口（Phase 2 可做自动归档/压缩/上限）

后置（可选增强）：
- 全局 sessions 目录最大占用（例如 1GB）：超出后按最旧删除/归档（仅在你明确希望“工具自动管控磁盘”时启用）

Codex 的 history.jsonl 做法是“硬上限 + 软回收比例”，可以直接借鉴到我们的 `history.jsonl`。

---

## 9. 与现有 Formax 架构的对接点（Where to integrate）

我们需要找到“事实上的单一事实源（source of truth）”：
- UI 侧：`Msg[]`（目前在 REPL/controller 里维护）
- 模型侧：`ChatHistory`（`PromptMessage[]`）

建议把 session-save 的 API 设计成很小的几条：
- `sessionWriter.recordUiMsg(msg: Msg)`
- `sessionWriter.recordHistory(historyDelta: PromptMessage | PromptMessage[])`
- `sessionWriter.recordEvent(name: string, data: unknown)`
- `sessionWriter.flush()` / `sessionWriter.shutdown()`

这样 Phase 2（让 /config 真正影响请求参数）时，不会把持久化逻辑牵扯得太乱。

---

## 10. 已对齐的决策（Phase 1）

1) **是否保存 tool result 的全文？**  
保存“尽可能完整可回放/可审计”的内容：默认写入 tool result 原文，但必须有上限：
- 单行/单条记录大小上限（超出则截断并标记 `truncated: true`）
- 单 session 最大字节数（超出则停止写入或继续截断并记录告警事件）

2) **是否保存 injected blocks 的“最终文本”？**  
Phase 1 默认不保存最终文本，按第 2 节的 A/B/C 分类落盘“元信息/事件”，恢复时重算（体积/隐私更可控）。

3) **/clear 的语义**  
对齐你刚验证的 CC：`/clear` = **新 session id**（清可见 transcript + 重置模型上下文），旧 session 可 `/resume` 找回。

4) **默认是否启用 session-save**  
默认启用，提供显式关闭入口（/config 或 env）。
