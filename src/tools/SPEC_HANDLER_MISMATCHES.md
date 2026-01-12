# Tool Spec 与 Handler 对齐检查报告

本报告列出了所有工具的 spec 定义与 handler 实现之间的不匹配点。

## 检查方法

- **Spec 来源**: `src/tools/modules/<tool>/spec.ts` 中的 `input_schema.properties`
- **Handler 来源**: `src/tools/modules/<tool>/handler.ts` 中的 `assertNoExtraKeys` 允许的字段列表
- **对比项**: 
  - Spec 中定义的属性 vs Handler 中允许的属性
  - Spec 中的 `required` 字段 vs Handler 中的必需性检查

## 不匹配项列表

### 1. ExitPlanMode

**Spec 定义** (`src/tools/modules/exitPlanMode/spec.ts`):
- `properties`: `launchSwarm` (boolean), `teammateCount` (number)
- `additionalProperties`: `true` (允许额外属性)

**Handler 实现** (`src/tools/modules/exitPlanMode/handler.ts`):
- **没有** `assertNoExtraKeys` 调用
- **没有** 读取 `launchSwarm` 或 `teammateCount` 参数
- Handler 完全不处理任何输入参数

**不匹配点**:
- ❌ Spec 定义了 `launchSwarm` 和 `teammateCount`，但 handler 完全不读取这些参数
- ❌ Spec 允许 `additionalProperties: true`，但 handler 没有输入验证（既不读取也不验证）
- ⚠️ Handler 的实现逻辑不依赖任何输入参数，但 spec 声明了这些属性

**建议**: 
- 这些属性可能是为了与 Claude Code 对齐而保留在 spec 中，但当前实现不需要它们
- 如果这些属性确实不需要，应该从 spec 中移除，或者添加输入验证以保持一致性
- 如果需要支持这些属性（例如 swarm 功能），handler 应该读取并处理它们

---

### 2. Skill

**Spec 定义** (`src/tools/modules/skill/spec.ts`):
- `properties`: `skill` (string, required)
- `additionalProperties`: `false`

**Handler 实现** (`src/tools/modules/skill/handler.ts`):
- **没有** `assertNoExtraKeys` 调用
- **没有** 读取 `skill` 参数
- Handler 直接返回 "not implemented" 错误，不处理任何输入

**不匹配点**:
- ❌ Spec 定义了 `skill` 参数（required），但 handler 完全不读取或验证这个参数
- ⚠️ Handler 返回 "not implemented" 错误，但 spec 声明了完整的 schema
- ⚠️ 即使工具未实现，也应该验证输入以保持一致性

**建议**:
- 这是预期的（工具未实现），但为了保持一致性，handler 应该添加基本的输入验证
- 可以在 handler 中添加 `assertNoExtraKeys(input, ['skill'], 'Skill.input')` 和读取 `skill` 参数，即使最终返回未实现错误

---

## 已匹配的工具

以下工具的 spec 与 handler 完全匹配：

1. ✅ **AskUserQuestion**: `questions`, `answers`
2. ✅ **Bash**: `command`, `timeout`, `description`, `run_in_background`, `dangerouslyDisableSandbox`
3. ✅ **Edit**: `file_path`, `old_string`, `new_string`, `replace_all`
4. ✅ **EnterPlanMode**: 空属性（匹配）
5. ✅ **Glob**: `pattern`, `path`
6. ✅ **Grep**: `pattern`, `path`, `glob`, `output_mode`, `-B`, `-A`, `-C`, `-n`, `-i`, `type`, `head_limit`, `offset`, `multiline`
7. ✅ **KillShell**: `shell_id`
8. ✅ **NotebookEdit**: `notebook_path`, `cell_id`, `new_source`, `cell_type`, `edit_mode`
9. ✅ **Read**: `file_path`, `offset`, `limit`
10. ✅ **SlashCommand**: `command`
11. ✅ **Task**: `description`, `prompt`, `subagent_type`, `model`, `resume`, `run_in_background`
12. ✅ **TaskOutput**: `task_id`, `block`, `timeout`
13. ✅ **TodoWrite**: `todos`
14. ✅ **WebFetch**: `url`, `prompt`
15. ✅ **WebSearch**: `query`, `allowed_domains`, `blocked_domains`
16. ✅ **Write**: `file_path`, `content`

## 总结

- **总工具数**: 18
- **完全匹配**: 16
- **不匹配**: 2
  - ExitPlanMode: Spec 定义了属性但 handler 不允许
  - Skill: Spec 定义了属性但 handler 未实现

## 注意事项

1. **ExitPlanMode**: Spec 中定义的 `launchSwarm` 和 `teammateCount` 可能是为了与 Claude Code 对齐，但当前实现不需要这些参数。需要决定是移除 spec 中的定义，还是在 handler 中支持它们。

2. **Skill**: 工具标记为未实现，但 spec 完整。这是合理的，因为 spec 需要与 Claude Code 对齐，但实现可以延后。

3. **默认值处理**: 某些工具在 spec 中定义了 `default` 值（如 `TaskOutput.block: true`, `TaskOutput.timeout: 30000`），handler 中也有相应的默认值处理逻辑，这是匹配的。

4. **类型验证**: Handler 中的类型检查（如 `typeof value === 'string'`）与 spec 中的类型定义（如 `type: 'string'`）基本一致。
