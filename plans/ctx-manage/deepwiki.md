## Codex上下文管理主要文件

### 核心文件列表

| 文件路径 | 主要功能 |
|---------|---------|
| `codex-rs/core/src/context_manager/history.rs` | ContextManager核心实现，管理对话历史和token使用 [1](#1-0)  |
| `codex-rs/core/src/state/session.rs` | SessionState整合上下文管理器和会话状态 [2](#1-1)  |
| `codex-rs/core/src/compact.rs` | 上下文压缩机制，处理历史对话压缩 [3](#1-2)  |
| `codex-rs/core/src/truncate.rs` | 文本截断策略，处理超长内容 [4](#1-3)  |
| `codex-rs/core/src/environment_context.rs` | 环境上下文管理，包含工作目录和shell信息 [5](#1-4)  |
| `codex-rs/core/src/codex.rs` | 主要会话逻辑，包含上下文监控和更新 [6](#1-5)  |
| `codex-rs/core/src/config/mod.rs` | 上下文相关配置管理 [7](#1-6)  |
| `codex-rs/core/src/models_manager/model_info.rs` | 模型特定的上下文窗口配置 [8](#1-7)  |

### 文件关系说明

这些文件构成了Codex的完整上下文管理系统：

1. **ContextManager** (`history.rs`) 是核心，负责维护对话历史和token统计 [9](#1-8) 
2. **SessionState** (`session.rs`) 将ContextManager集成到会话级别 [10](#1-9) 
3. **压缩机制** (`compact.rs`) 在接近上下文限制时自动压缩历史 [11](#1-10) 
4. **截断策略** (`truncate.rs`) 处理单个内容的长度限制
5. **环境上下文** (`environment_context.rs`) 提供工作环境信息给模型 [12](#1-11) 
6. **主逻辑** (`codex.rs`) 协调所有组件并监控token使用 [13](#1-12) 

## Notes

这些文件共同实现了Codex的智能上下文管理，确保对话能够在模型的token限制内持续进行。测试文件如 `codex-rs/core/src/context_manager/history_tests.rs` 和 `codex-rs/core/tests/suite/compact_resume_fork.rs` 也包含重要的测试用例，验证上下文管理的正确性。

Wiki pages you might want to explore:
- [Architecture Overview (openai/codex)](/wiki/openai/codex#1.3)
- [Context Compaction (openai/codex)](/wiki/openai/codex#3.7)

### Citations

**File:** codex-rs/core/src/context_manager/history.rs (L20-25)
```rust
#[derive(Debug, Clone, Default)]
pub(crate) struct ContextManager {
    /// The oldest items are at the beginning of the vector.
    items: Vec<ResponseItem>,
    token_info: Option<TokenUsageInfo>,
}
```

**File:** codex-rs/core/src/context_manager/history.rs (L28-33)
```rust
    pub(crate) fn new() -> Self {
        Self {
            items: Vec::new(),
            token_info: TokenUsageInfo::new_or_append(&None, &None, None),
        }
    }
```

**File:** codex-rs/core/src/state/session.rs (L13-17)
```rust
pub(crate) struct SessionState {
    pub(crate) session_configuration: SessionConfiguration,
    pub(crate) history: ContextManager,
    pub(crate) latest_rate_limits: Option<RateLimitSnapshot>,
}
```

**File:** codex-rs/core/src/state/session.rs (L21-27)
```rust
    pub(crate) fn new(session_configuration: SessionConfiguration) -> Self {
        let history = ContextManager::new();
        Self {
            session_configuration,
            history,
            latest_rate_limits: None,
        }
```

**File:** codex-rs/core/src/compact.rs (L42-44)
```rust
pub(crate) async fn run_inline_auto_compact_task(
    sess: Arc<Session>,
    turn_context: Arc<TurnContext>,
```

**File:** codex-rs/core/src/compact.rs (L123-130)
```rust
            Err(e @ CodexErr::ContextWindowExceeded) => {
                if turn_input_len > 1 {
                    // Trim from the beginning to preserve cache (prefix-based) and keep recent messages intact.
                    error!(
                        "Context window exceeded while compacting; removing oldest history item. Error: {e}"
                    );
                    history.remove_first_item();
                    truncated_count += 1;
```

**File:** codex-rs/core/src/codex.rs (L1416-1420)
```rust
    pub(crate) async fn update_token_usage_info(
        &self,
        turn_context: &TurnContext,
        token_usage: Option<&TokenUsage>,
    ) {
```

**File:** codex-rs/core/src/codex.rs (L1487-1492)
```rust
    pub(crate) async fn set_total_tokens_full(&self, turn_context: &TurnContext) {
        if let Some(context_window) = turn_context.client.get_model_context_window() {
            let mut state = self.state.lock().await;
            state.set_token_usage_full(context_window);
        }
        self.send_token_count_event(turn_context).await;
```

**File:** codex-rs/core/src/config/mod.rs (L700-705)
```rust
    /// Size of the context window for the model, in tokens.
    pub model_context_window: Option<i64>,

    /// Token usage threshold triggering auto-compaction of conversation history.
    pub model_auto_compact_token_limit: Option<i64>,

```

**File:** codex-rs/core/src/models_manager/model_info.rs (L70-75)
```rust
    if let Some(context_window) = config.model_context_window {
        model.context_window = Some(context_window);
    }
    if let Some(auto_compact_token_limit) = config.model_auto_compact_token_limit {
        model.auto_compact_token_limit = Some(auto_compact_token_limit);
    }
```
