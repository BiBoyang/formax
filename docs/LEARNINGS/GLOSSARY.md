# Glossary（术语表）

这份术语表专门服务于 `docs/LEARNINGS/`，尽量用通俗语言解释。

## Tool / Tool Use

- **Tool（工具）**：模型可以调用的一段“可执行能力”，例如 `Read`/`Write`/`Bash`/`TodoWrite`。
- **tool_use**：模型发起一次工具调用的“请求块”（包含 `id`、`name`、`input`）。
- **tool_result**：工具执行后返回给模型的“结果块”（包含 `tool_use_id`、`content`，可带 `is_error`）。

## Prompt / Blocks

- **System prompt**：系统级指令，告诉模型“你是谁/要遵守什么规则/有哪些工具”。
- **Prompt block**：为了支持富结构，消息内容可能不是纯字符串，而是由多个块组成（text/tool_use/tool_result 等）。
- **system-reminder**：一种“只给模型看、不让用户看到”的提示块（通常包在 `<system-reminder>...</system-reminder>`），用于提醒模型不要忘事（比如 todo 为空、计划模式开启等）。

## Slash Commands / Local Commands

- **slash command**：用户在终端输入的 `/xxx` 命令（例如 `/todos`、`/tasks`）。
- **local command stdout 注入**：命令行输出除了展示给用户，有时还会被**记录进下一轮对话**，以 `<local-command-stdout>...</local-command-stdout>` 的方式喂给模型（并带 `Caveat` 说明“不要响应它，除非用户要求”）。

## Subagents（子任务）

- **Task / subagent**：把一个复杂任务交给“子代理”去跑。子代理通常有独立的上下文、会调用工具，并把结果汇总回主代理。

## Mode / Approval

- **plan mode**：偏“先制定计划、再执行”的模式。
- **accept edits mode**：允许工具直接写文件/改文件的模式（具体策略由项目实现决定）。
- **approval / confirm**：当工具要做可能有风险的操作（写文件、执行命令等），UI 会提示用户确认。

