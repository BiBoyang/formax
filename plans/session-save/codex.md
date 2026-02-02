关键文件：
相关文件路径
数据文件路径
~/.codex/history.jsonl - 消息历史文件 message_history.rs:47-48
~/.codex/sessions/YYYY/MM/DD/rollout-{timestamp}-{thread_id}.jsonl - 会话完整记录文件 recorder.rs:493-512
~/.codex/archived_sessions/ - 归档会话目录 mod.rs:6
源代码文件路径
codex-rs/core/src/message_history.rs - 消息历史管理 message_history.rs:72-76
codex-rs/core/src/rollout/recorder.rs - 会话记录管理 recorder.rs:49-63
codex-rs/core/src/rollout/mod.rs - 会话模块常量定义 mod.rs:5
codex-rs/tui/src/cli.rs - TUI命令行参数
codex-rs/exec/src/cli.rs - Exec命令行参数
codex-rs/tui/src/resume_picker.rs - 会话选择界面
codex-rs/utils/home-dir/src/lib.rs - Codex主目录配置


# Codex 会话历史记录保存机制

## 1. 两种历史记录系统

Codex 使用**两种不同的历史记录系统**来保存会话信息：

### 1.1 消息历史（Message History）
这是一个轻量级的跨会话消息日志，保存所有用户发送的消息。

**文件路径：** `~/.codex/history.jsonl` [1](#0-0) 

每条记录的格式为：
```
{"conversation_id":"<uuid>","ts":<unix_seconds>,"text":"<message>"}
``` [2](#0-1) 

这个文件是追加式的，使用 JSONL 格式（每行一个 JSON 对象）。写入操作通过 `append_entry()` 函数完成，并使用文件锁来确保并发写入的安全性。 [3](#0-2) 

### 1.2 会话完整记录（Session Rollouts）
这是完整的会话录制，包含所有对话内容、工具调用和元数据，支持恢复和分叉功能。

**文件路径格式：** `~/.codex/sessions/YYYY/MM/DD/rollout-{timestamp}-{conversation_id}.jsonl` [4](#0-3) 

路径组成部分：
- `CODEX_HOME` 默认为 `~/.codex`
- `sessions` 是会话目录常量 [5](#0-4) 
- 按日期组织：`YYYY/MM/DD`
- 文件名格式：`rollout-YYYY-MM-DDThh-mm-ss-{UUID}.jsonl`（使用 `-` 代替 `:` 以兼容不同文件系统） [6](#0-5) 

## 2. 关键文件说明

### 核心实现文件：

1. **`codex-rs/core/src/message_history.rs`** - 负责消息历史的持久化
   - 实现 `append_entry()` 写入消息
   - 处理文件锁和并发访问
   - 支持历史记录大小限制

2. **`codex-rs/core/src/rollout/recorder.rs`** - 负责会话完整记录
   - `RolloutRecorder` 类管理会话文件
   - `create_log_file()` 创建会话文件
   - `load_rollout_items()` 加载会话数据
   - `get_rollout_history()` 获取恢复所需的历史 [7](#0-6) 

3. **`codex-rs/core/src/rollout/mod.rs`** - 定义会话目录常量

## 3. 如何在新终端恢复会话

### 3.1 TUI 模式（交互式界面）

有多种方式恢复会话：

**方式一：恢复最近的会话**
```bash
codex --resume-last
``` [8](#0-7) 

**方式二：通过 Session ID 恢复**
```bash
codex --resume-session-id <UUID或线程名>
``` [9](#0-8) 

**方式三：交互式选择器**
```bash
codex --resume-picker
``` [10](#0-9) 

### 3.2 Exec 模式（非交互式）

**方式一：恢复最近的会话**
```bash
codex exec resume --last
``` [11](#0-10) 

**方式二：通过 Session ID 恢复**
```bash
codex exec resume <SESSION_ID>
``` [12](#0-11) 

### 3.3 恢复机制原理

恢复流程如下：

1. **加载会话文件** - `RolloutRecorder::load_rollout_items()` 读取 rollout.jsonl 文件 [13](#0-12) 

2. **构建历史对象** - `get_rollout_history()` 创建 `InitialHistory::Resumed` 对象 [14](#0-13) 

3. **重放会话** - 系统重放所有 `RolloutItem::ResponseItem` 条目来重建对话历史

## 4. 完整文件路径总结

### 数据文件：
- **消息历史：** `~/.codex/history.jsonl`
- **会话记录：** `~/.codex/sessions/YYYY/MM/DD/rollout-{timestamp}-{thread_id}.jsonl`
- **归档会话：** `~/.codex/archived_sessions/` [15](#0-14) 

### 源代码文件：
- `codex-rs/core/src/message_history.rs` - 消息历史管理
- `codex-rs/core/src/rollout/recorder.rs` - 会话记录管理
- `codex-rs/core/src/rollout/mod.rs` - 会话模块常量定义
- `codex-rs/tui/src/cli.rs` - TUI 命令行参数
- `codex-rs/exec/src/cli.rs` - Exec 命令行参数
- `codex-rs/tui/src/resume_picker.rs` - 会话选择界面

## Notes

**重要区别：**
- `history.jsonl` 只保存用户消息的简单记录，用于历史导航
- `rollout-*.jsonl` 文件保存完整的会话记录，包括 AI 响应、工具调用等所有信息，用于完整恢复会话

**配置控制：**
- 消息历史的保存受 `config.history.persistence` 配置控制（SaveAll 或 None） [16](#0-15) 
- 会话记录的保存受 `ephemeral` 配置控制，当为 `true` 时不保存到磁盘

**过滤选项：**
使用 `--resume-show-all` 或 `--all` 可以显示所有会话，否则默认只显示当前工作目录下的会话。

### Citations

**File:** codex-rs/core/src/message_history.rs (L5-9)
```rust
//! JSON-Lines tooling. Each record has the following schema:
//!
//! ````text
//! {"conversation_id":"<uuid>","ts":<unix_seconds>,"text":"<message>"}
//! ````
```

**File:** codex-rs/core/src/message_history.rs (L47-48)
```rust
/// Filename that stores the message history inside `~/.codex`.
const HISTORY_FILENAME: &str = "history.jsonl";
```

**File:** codex-rs/core/src/message_history.rs (L72-76)
```rust
pub(crate) async fn append_entry(
    text: &str,
    conversation_id: &ThreadId,
    config: &Config,
) -> Result<()> {
```

**File:** codex-rs/core/src/message_history.rs (L77-85)
```rust
    match config.history.persistence {
        HistoryPersistence::SaveAll => {
            // Save everything: proceed.
        }
        HistoryPersistence::None => {
            // No history persistence requested.
            return Ok(());
        }
    }
```

**File:** codex-rs/core/src/rollout/recorder.rs (L49-63)
```rust
/// Records all [`ResponseItem`]s for a session and flushes them to disk after
/// every update.
///
/// Rollouts are recorded as JSONL and can be inspected with tools such as:
///
/// ```ignore
/// $ jq -C . ~/.codex/sessions/rollout-2025-05-07T17-24-21-5973b6c0-94b8-487b-a530-2aeb6098ae0e.jsonl
/// $ fx ~/.codex/sessions/rollout-2025-05-07T17-24-21-5973b6c0-94b8-487b-a530-2aeb6098ae0e.jsonl
/// ```
#[derive(Clone)]
pub struct RolloutRecorder {
    tx: Sender<RolloutCmd>,
    pub(crate) rollout_path: PathBuf,
    state_db: Option<StateDbHandle>,
}
```

**File:** codex-rs/core/src/rollout/recorder.rs (L381-444)
```rust
    pub(crate) async fn load_rollout_items(
        path: &Path,
    ) -> std::io::Result<(Vec<RolloutItem>, Option<ThreadId>, usize)> {
        info!("Resuming rollout from {path:?}");
        let text = tokio::fs::read_to_string(path).await?;
        if text.trim().is_empty() {
            return Err(IoError::other("empty session file"));
        }

        let mut items: Vec<RolloutItem> = Vec::new();
        let mut thread_id: Option<ThreadId> = None;
        let mut parse_errors = 0usize;
        for line in text.lines() {
            if line.trim().is_empty() {
                continue;
            }
            let v: Value = match serde_json::from_str(line) {
                Ok(v) => v,
                Err(e) => {
                    warn!("failed to parse line as JSON: {line:?}, error: {e}");
                    parse_errors = parse_errors.saturating_add(1);
                    continue;
                }
            };

            // Parse the rollout line structure
            match serde_json::from_value::<RolloutLine>(v.clone()) {
                Ok(rollout_line) => match rollout_line.item {
                    RolloutItem::SessionMeta(session_meta_line) => {
                        // Use the FIRST SessionMeta encountered in the file as the canonical
                        // thread id and main session information. Keep all items intact.
                        if thread_id.is_none() {
                            thread_id = Some(session_meta_line.meta.id);
                        }
                        items.push(RolloutItem::SessionMeta(session_meta_line));
                    }
                    RolloutItem::ResponseItem(item) => {
                        items.push(RolloutItem::ResponseItem(item));
                    }
                    RolloutItem::Compacted(item) => {
                        items.push(RolloutItem::Compacted(item));
                    }
                    RolloutItem::TurnContext(item) => {
                        items.push(RolloutItem::TurnContext(item));
                    }
                    RolloutItem::EventMsg(_ev) => {
                        items.push(RolloutItem::EventMsg(_ev));
                    }
                },
                Err(e) => {
                    warn!("failed to parse rollout line: {e}");
                    parse_errors = parse_errors.saturating_add(1);
                }
            }
        }

        tracing::debug!(
            "Resumed rollout with {} items, thread ID: {:?}, parse errors: {}",
            items.len(),
            thread_id,
            parse_errors,
        );
        Ok((items, thread_id, parse_errors))
    }
```

**File:** codex-rs/core/src/rollout/recorder.rs (L446-461)
```rust
    pub async fn get_rollout_history(path: &Path) -> std::io::Result<InitialHistory> {
        let (items, thread_id, _parse_errors) = Self::load_rollout_items(path).await?;
        let conversation_id = thread_id
            .ok_or_else(|| IoError::other("failed to parse thread ID from rollout file"))?;

        if items.is_empty() {
            return Ok(InitialHistory::New);
        }

        info!("Resumed rollout successfully from {path:?}");
        Ok(InitialHistory::Resumed(ResumedHistory {
            conversation_id,
            history: items,
            rollout_path: path.to_path_buf(),
        }))
    }
```

**File:** codex-rs/core/src/rollout/recorder.rs (L493-502)
```rust
fn create_log_file(config: &Config, conversation_id: ThreadId) -> std::io::Result<LogFileInfo> {
    // Resolve ~/.codex/sessions/YYYY/MM/DD and create it if missing.
    let timestamp = OffsetDateTime::now_local()
        .map_err(|e| IoError::other(format!("failed to get local time: {e}")))?;
    let mut dir = config.codex_home.clone();
    dir.push(SESSIONS_SUBDIR);
    dir.push(timestamp.year().to_string());
    dir.push(format!("{:02}", u8::from(timestamp.month())));
    dir.push(format!("{:02}", timestamp.day()));
    fs::create_dir_all(&dir)?;
```

**File:** codex-rs/core/src/rollout/recorder.rs (L504-512)
```rust
    // Custom format for YYYY-MM-DDThh-mm-ss. Use `-` instead of `:` for
    // compatibility with filesystems that do not allow colons in filenames.
    let format: &[FormatItem] =
        format_description!("[year]-[month]-[day]T[hour]-[minute]-[second]");
    let date_str = timestamp
        .format(format)
        .map_err(|e| IoError::other(format!("failed to format timestamp: {e}")))?;

    let filename = format!("rollout-{date_str}-{conversation_id}.jsonl");
```

**File:** codex-rs/core/src/rollout/mod.rs (L5-5)
```rust
pub const SESSIONS_SUBDIR: &str = "sessions";
```

**File:** codex-rs/core/src/rollout/mod.rs (L6-6)
```rust
pub const ARCHIVED_SESSIONS_SUBDIR: &str = "archived_sessions";
```

**File:** codex-rs/tui/src/cli.rs (L21-24)
```rust
    pub resume_picker: bool,

    #[clap(skip)]
    pub resume_last: bool,
```

**File:** codex-rs/tui/src/cli.rs (L26-29)
```rust
    /// Internal: resume a specific recorded session by id (UUID). Set by the
    /// top-level `codex resume <SESSION_ID>` wrapper; not exposed as a public flag.
    #[clap(skip)]
    pub resume_session_id: Option<String>,
```

**File:** codex-rs/tui/src/lib.rs (L623-630)
```rust
    } else if cli.resume_picker {
        match resume_picker::run_resume_picker(
            &mut tui,
            &config.codex_home,
            &config.model_provider_id,
            cli.resume_show_all,
        )
        .await?
```

**File:** codex-rs/exec/src/cli.rs (L117-120)
```rust
    /// Conversation/session id (UUID) or thread name. UUIDs take precedence if it parses.
    /// If omitted, use --last to pick the most recent recorded session.
    #[arg(value_name = "SESSION_ID")]
    session_id: Option<String>,
```

**File:** codex-rs/exec/src/cli.rs (L122-124)
```rust
    /// Resume the most recent recorded session (newest) without specifying an id.
    #[arg(long = "last", default_value_t = false)]
    last: bool,
```

