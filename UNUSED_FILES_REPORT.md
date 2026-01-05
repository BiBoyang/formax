# 未使用的 TypeScript/TSX 文件分析报告

## 分析结果

经过分析，以下文件**可能未被使用**：

### 确认未使用的文件（10个）

1. **src/components/chat/ChatMessage.tsx**
   - 状态：未找到任何导入
   - 说明：定义了 `ChatMessage` 组件，但项目中未使用

2. **src/components/display/ComponentsShowcase.tsx**
   - 状态：未找到任何导入
   - 说明：定义了 `ComponentsShowcase` 组件，但项目中未使用

3. **src/components/display/ink.tsx**
   - 状态：仅被 `ComponentsShowcase.tsx` 导入（但该文件本身未使用）
   - 说明：重新导出 ink 库的内容，但未被实际使用

4. **src/components/display/inkjs-ui.tsx**
   - 状态：仅被 `ComponentsShowcase.tsx` 导入（但该文件本身未使用）
   - 说明：重新导出 @inkjs/ui 库的内容，但未被实际使用

5. **src/components/ui/CodePreview.tsx**
   - 状态：未找到任何导入
   - 说明：定义了 `CodePreview` 组件，但项目中未使用

6. **src/components/ui/PressEnterToContinue.tsx**
   - 状态：未找到任何导入
   - 说明：定义了 `PressEnterToContinue` 组件，但项目中未使用

7. **src/components/ui/Select.tsx**
   - 状态：未找到任何导入
   - 说明：定义了自定义 `Select` 组件，但项目中未使用（项目使用 @inkjs/ui 的 Select）

8. **src/services/chat.ts**
   - 状态：未找到任何导入
   - 说明：定义了 `sendMessage` 函数，但项目中未使用

9. **src/services/models.ts**
   - 状态：未找到任何导入
   - 说明：定义了模型获取函数，但项目中未使用

10. **src/utils/model.ts**
    - 状态：未找到任何导入
    - 说明：定义了 `ModelManager` 类，但项目中未使用

### 注意：可能被使用的文件（1个）

1. **src/agent2/sse/streamingParser.ts**
   - 状态：**实际上被使用**
   - 说明：被 `src/agent2/streaming/StreamClient.ts` 导入使用
   - 原因：脚本的路径解析可能有问题，但手动验证确认该文件是被使用的

## 建议

1. **可以安全删除的文件**（10个）：
   - `src/components/chat/ChatMessage.tsx`
   - `src/components/display/ComponentsShowcase.tsx`
   - `src/components/display/ink.tsx`
   - `src/components/display/inkjs-ui.tsx`
   - `src/components/ui/CodePreview.tsx`
   - `src/components/ui/PressEnterToContinue.tsx`
   - `src/components/ui/Select.tsx`
   - `src/services/chat.ts`
   - `src/services/models.ts`
   - `src/utils/model.ts`

2. **保留的文件**：
   - `src/agent2/sse/streamingParser.ts` - 被 StreamClient 使用

3. **删除前请确认**：
   - 这些文件可能通过动态导入（`import()`）被使用
   - 检查是否有配置文件或构建脚本引用这些文件
   - 确认这些文件不是计划中要使用的代码

## 生成时间

报告生成时间：$(date)
