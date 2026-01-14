# PR6 改进任务清单

基于 commit `4df515d` 的 review，以下是需要改进的点，按优先级排序。

## 🔴 高优先级

### 1. 补充 Glob/Grep 的 tool→action 映射

**问题：**
当前 `toolCallToPolicyAction` 只支持 Bash, Read, Edit, Write, NotebookEdit, WebFetch, WebSearch，缺少 Glob 和 Grep。

**影响：**
- Glob/Grep 工具无法通过 policy preflight 进行审批
- 可能导致安全漏洞（无法拦截危险的文件搜索）

**实现位置：**
`src/tools/executor/policyPreflight.ts` 的 `toolCallToPolicyAction` 函数

**实现建议：**
```typescript
case 'Glob': {
  const patternRaw = obj && typeof obj.pattern === 'string' ? obj.pattern : ''
  if (!patternRaw.trim()) return null
  try {
    // Glob 通常用于搜索文件，应该映射到 fs.read
    // 但需要考虑：Glob 可能访问多个文件，policy 需要支持路径模式匹配
    const { absolutePath } = requireAbsolutePath({ 
      cwd, 
      rawPath: patternRaw, 
      fieldName: 'pattern' 
    })
    return { kind: 'fs.read', path: absolutePath }
  } catch {
    // 如果 pattern 包含通配符，可能需要特殊处理
    // 暂时返回 null，让 preflight 跳过（或创建新的 action 类型）
    return null
  }
}
case 'Grep': {
  const patternRaw = obj && typeof obj.pattern === 'string' ? obj.pattern : ''
  const pathRaw = obj && typeof obj.path === 'string' ? obj.path : ''
  if (!patternRaw.trim() || !pathRaw.trim()) return null
  try {
    const { absolutePath } = requireAbsolutePath({ 
      cwd, 
      rawPath: pathRaw, 
      fieldName: 'path' 
    })
    return { kind: 'fs.read', path: absolutePath }
  } catch {
    return null
  }
}
```

**测试要求：**
- 测试 Glob 工具调用能正确转换为 PolicyAction
- 测试 Grep 工具调用能正确转换为 PolicyAction
- 测试包含通配符的 pattern 处理

---

### 2. 改进非交互模式的错误信息

**问题：**
当没有 `userInput`（非交互模式）时，错误信息不够详细，缺少 policy explain 信息。

**影响：**
- CI/自动化场景下无法获取详细的拒绝原因
- 无法知道如何修复（缺少 suggestions）

**实现位置：**
`src/tools/executor/approvalService.ts` 的 `ensureApproved` 函数

**当前实现：**
```typescript
if (!args.userInput) {
  return {
    ok: false,
    result: {
      tool_use_id: call.id,
      content: `Error: Approval required for ${args2.action.kind}, but no interactive UI is available.`,
      is_error: true,
    },
  }
}
```

**改进建议：**
```typescript
if (!args.userInput) {
  const lines: string[] = []
  lines.push(`Error: Approval required for ${args2.action.kind}, but no interactive UI is available.`)
  lines.push(`Action: ${JSON.stringify(args2.action)}`)
  
  // 从 loaded 中获取 explain 信息（需要传入 explained）
  // 或者在这里重新调用 explainPolicy
  const explained = explainPolicy({ 
    action: args2.action, 
    rules: args2.loaded.mergedRules 
  })
  
  if (explained.matchedRule) {
    lines.push(`Matched rule: ${explained.matchedRule.ruleId} (${explained.matchedRule.scope})`)
    if (explained.matchedRule.reason) {
      lines.push(`Reason: ${explained.matchedRule.reason}`)
    }
  }
  
  for (const s of explained.suggestions || []) {
    lines.push(`Suggestion: ${s}`)
  }
  
  for (const w of args2.loaded.warnings || []) {
    lines.push(`Warning: ${w}`)
  }
  
  return {
    ok: false,
    result: {
      tool_use_id: call.id,
      content: lines.join('\n'),
      is_error: true,
    },
  }
}
```

**注意：**
- 需要修改 `ensureApproved` 的签名，传入 `explained` 或 `loaded` 中包含 explain 信息
- 或者在这里重新调用 `explainPolicy`（性能稍差但更简单）

**测试要求：**
- 测试非交互模式下错误信息包含 action 信息
- 测试错误信息包含 matchedRule 和 suggestions
- 测试错误信息格式正确

---

## 🟡 中优先级

### 3. 增加 Remember 持久化的测试

**问题：**
当前测试没有覆盖 remember 持久化到 rules 文件的场景。

**影响：**
- 无法验证规则是否正确写入
- 无法验证规则 ID 生成是否正确
- 无法验证重复规则的处理

**实现位置：**
`src/tools/executor/policyPreflight.test.ts` 或新建 `src/tools/executor/approvalService.test.ts`

**测试用例：**
```typescript
describe('ApprovalService remember persistence', () => {
  it('persists allow rule when user chooses approve_remember with project scope', async () => {
    // 1. 创建 ApprovalService
    // 2. 模拟用户选择 approve_remember + project scope
    // 3. 验证规则写入 project rules 文件
    // 4. 验证规则内容正确（ruleId, match, decision, scope）
  })

  it('persists allow rule when user chooses approve_remember with global scope', async () => {
    // 类似上面，但验证写入 global rules
  })

  it('does not create duplicate rules for the same action', async () => {
    // 1. 第一次 approve_remember
    // 2. 第二次 approve_remember（相同 action）
    // 3. 验证 rules 文件中只有一条规则
  })

  it('generates unique ruleId for different actions', async () => {
    // 验证不同 action 生成不同的 ruleId
  })
})
```

---

### 4. 增加 Session Rules 的测试

**问题：**
当前测试没有覆盖 session rules 的场景。

**影响：**
- 无法验证 session rules 是否正确应用
- 无法验证 session rules 的优先级（应该在 global/project 之前）

**测试用例：**
```typescript
describe('Session rules', () => {
  it('applies session rules before global/project rules', async () => {
    // 1. 设置 global rule: deny
    // 2. 添加 session rule: allow
    // 3. 验证 session rule 优先（allow 生效）
  })

  it('session rules are cleared on service recreation', async () => {
    // 验证 session rules 只在内存中，不持久化
  })

  it('session rules work with approve_remember session scope', async () => {
    // 验证选择 session scope 时，规则添加到 session rules
  })
})
```

---

### 5. 优化 Rule ID 生成（避免冲突）

**问题：**
当前 ruleId 生成基于 `action.kind + shortId(action) + createdAt`，如果同一秒内多次批准相同 action，可能生成相同 ruleId。

**影响：**
- 可能导致规则覆盖（如果 ruleId 相同）
- 无法区分同一秒内的多次批准

**实现位置：**
`src/core/approval/rules.ts` 的 `createAllowRuleFromAction` 函数

**当前实现：**
```typescript
const ruleId = `remember-${sanitizeIdPart(args.action.kind)}-${shortId(args.action)}-${sanitizeIdPart(createdAt)}`
```

**改进建议：**
```typescript
// 方案 1: 添加随机后缀
import { randomBytes } from 'node:crypto'
const randomSuffix = randomBytes(4).toString('hex')
const ruleId = `remember-${sanitizeIdPart(args.action.kind)}-${shortId(args.action)}-${sanitizeIdPart(createdAt)}-${randomSuffix}`

// 方案 2: 使用更精确的时间戳（包含毫秒和微秒）
const timestamp = Date.now() + '-' + process.hrtime.bigint().toString().slice(-6)
const ruleId = `remember-${sanitizeIdPart(args.action.kind)}-${shortId(args.action)}-${timestamp}`

// 方案 3: 使用 hash（推荐）
import { createHash } from 'node:crypto'
const hashInput = `${args.action.kind}-${JSON.stringify(args.action)}-${createdAt}-${Math.random()}`
const hash = createHash('sha256').update(hashInput).digest('hex').slice(0, 8)
const ruleId = `remember-${sanitizeIdPart(args.action.kind)}-${shortId(args.action)}-${hash}`
```

**推荐方案 3**，因为：
- 确定性：相同输入生成相同 hash（但加了 random，所以每次不同）
- 简短：只取前 8 位 hex
- 唯一性：碰撞概率极低

**测试要求：**
- 测试同一秒内多次批准相同 action 生成不同的 ruleId
- 测试 ruleId 格式正确（符合 schema）

---

## 🟢 低优先级

### 6. 改进错误处理的粒度

**问题：**
当前错误处理比较粗糙，所有错误都返回相同的格式。

**实现位置：**
`src/tools/executor/approvalService.ts` 的 `persistAllowRule` 函数

**改进建议：**
```typescript
catch (e) {
  const msg = e instanceof Error ? e.message : String(e)
  
  // 区分不同类型的错误
  let errorType = 'unknown'
  let userMessage = msg
  
  if (msg.includes('EACCES') || msg.includes('permission')) {
    errorType = 'permission_denied'
    userMessage = 'Permission denied when saving policy rule. Check file permissions.'
  } else if (msg.includes('ENOSPC') || msg.includes('space')) {
    errorType = 'disk_full'
    userMessage = 'Disk full. Cannot save policy rule.'
  } else if (msg.includes('JSON') || msg.includes('parse')) {
    errorType = 'invalid_format'
    userMessage = 'Invalid policy rule format. Please check the rules file.'
  }
  
  return {
    ok: false,
    result: {
      tool_use_id: args2.toolUseId,
      content: `Error: Failed to save policy rule (${errorType}): ${userMessage}`,
      is_error: true,
      // 可以考虑添加 errorCode 字段
    },
  }
}
```

---

### 7. 添加更多边界场景测试

**测试用例：**
```typescript
describe('Edge cases', () => {
  it('handles approval cancellation gracefully', async () => {
    // 测试用户取消审批时的行为
  })

  it('handles signal abort during approval', async () => {
    // 测试审批过程中 signal abort 的处理
  })

  it('handles concurrent approvals for the same tool call', async () => {
    // 测试并发场景（虽然不太可能，但应该处理）
  })

  it('handles invalid scope values', async () => {
    // 测试传入无效 scope 时的处理
  })

  it('handles approval service being null/undefined', async () => {
    // 测试 preflight 中 approval 为 undefined 时的行为
  })
})
```

---

### 8. 考虑 Session Rules 的持久化（可选）

**问题：**
当前 session rules 只在内存中，重启后丢失。如果用户选择 "remember for session"，重启后需要重新批准。

**讨论：**
- PR6 要求："一次批准/永久批准都会落到 rules"
- Session 规则是否应该持久化？如果持久化，应该存储在哪里？
- 建议：Session 规则可以写入临时文件（如 `~/.formax/session-rules.json`），在启动时加载，退出时清理

**实现建议（可选）：**
```typescript
// 在 ApprovalService 中添加
async function persistSessionRule(action: PolicyAction): Promise<void> {
  const sessionRulesPath = path.join(args.homedir, '.formax', 'session-rules.json')
  // 读取现有 session rules
  // 添加新规则
  // 写入文件
}

// 在 createApprovalService 启动时加载
async function loadSessionRules(): Promise<PolicyRule[]> {
  // 从文件加载
}
```

**注意：**
- 这个改进是可选的，需要讨论是否真的需要
- 如果实现，需要考虑清理时机（退出时？还是每次启动时清理旧的？）

---

## 实施建议

### 优先级排序
1. **必须做**：补充 Glob/Grep 映射（安全相关）
2. **应该做**：改进非交互模式错误信息（用户体验）
3. **建议做**：增加测试覆盖（质量保证）
4. **可选做**：其他优化（锦上添花）

### 建议拆分为多个 PR
- **PR6e**：补充 Glob/Grep 映射 + 改进非交互模式错误
- **PR6f**：增加测试覆盖（Remember 持久化 + Session Rules）
- **PR6g**：优化和边界场景处理（可选）

### 验收标准
- [ ] Glob/Grep 工具调用能正确通过 policy preflight
- [ ] 非交互模式下错误信息包含完整的 explain 信息
- [ ] Remember 持久化有完整的测试覆盖
- [ ] Session Rules 有测试覆盖
- [ ] Rule ID 生成不会冲突
- [ ] 所有测试通过

---

## 相关文件

- `src/tools/executor/policyPreflight.ts` - tool→action 映射
- `src/tools/executor/approvalService.ts` - 审批服务
- `src/core/approval/rules.ts` - 规则生成
- `src/tools/executor/policyPreflight.test.ts` - 测试文件
