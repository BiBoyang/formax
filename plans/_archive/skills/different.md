# Skill 工具使用前后对比分析

## 测试场景

**用户问题**：帮我用 js html tailwild 写一个 todolist ，要求画面精美

**对比场景**：
- **场景 A（无 skill）**：`proxy/traffic-logs/0011_2026-01-17T20-48-25,837_REQ__v1_messages.simple.json`
  - 没有 `.claude/skills/frontend-design/SKILL.md` 文件
- **场景 B（有 skill）**：`proxy/traffic-logs-next/0006_2026-01-17T20-58-55,312_REQ__v1_messages.simple.json`
  - 存在 `.claude/skills/frontend-design/SKILL.md` 文件

> 备注：以上对比材料来自 Claude Code（`.claude` 目录）。Formax 实现只对齐行为与机制，目录与文件名以 `.formax` 为准（不做 `.claude` 兼容读取）。

---

## 关键区别

### 1. Skill 工具定义差异

#### 场景 A（无 skill）
```json
"description": "...\n<available_skills>\n\n</available_skills>\n"
```
- `<available_skills>` 为空
- Skill 工具虽然存在，但没有可用的 skill

#### 场景 B（有 skill）
```json
"description": "...\n<available_skills>\n...\n</available_skills>\n"
```
- `<available_skills>` 包含 `frontend-design` skill（具体格式可能随 Claude Code 版本变化）
- Skill 工具提供了可用的技能

---

### 2. 执行流程差异

#### 场景 A（无 skill）执行流程
1. **思考阶段**：简单分析需求，决定创建 HTML 文件
2. **探索阶段**：使用 `Bash` 工具执行 `ls -la` 查看目录结构
3. **创建阶段**：直接使用 `Write` 工具创建 `todolist.html`
4. **完成阶段**：使用 `Bash` 工具打开文件

**工具调用序列**：
```
Bash (ls -la) → Write (创建文件) → Bash (打开文件)
```

#### 场景 B（有 skill）执行流程
1. **识别阶段**：识别为前端开发任务，决定使用 Skill 工具
2. **调用阶段**：使用 `Skill` 工具调用 `frontend-design` skill
3. **指导阶段**：Skill 返回详细的设计指导信息
4. **设计阶段**：深入思考设计方向（新野兽主义 × 日式极简主义）
5. **创建阶段**：使用 `Write` 工具创建 `todolist.html`

**工具调用序列**：
```
Skill (frontend-design) → Write (创建文件)
```

---

### 3. 思考深度差异

#### 场景 A（无 skill）思考内容
```
用户想要我创建一个使用 JS、HTML 和 Tailwind CSS 的 todolist，要求画面精美。

这是一个创建新文件的任务。让我先检查一下当前目录的结构...

让我创建一个单文件的 HTML 应用，包含：
1. 美观的 UI 设计
2. 添加、删除、完成待办事项的功能
3. 本地存储支持
4. 动画效果
5. 响应式设计

我会使用 Tailwind CSS CDN 来快速构建精美的界面。
```

**特点**：
- 思考相对简单直接
- 功能导向，关注实现
- 设计思路较通用

#### 场景 B（有 skill）思考内容
```
根据指南，当用户要求构建 web 组件、页面或应用程序时，我应该使用 Skill 工具来调用 frontend-design 技能。

根据 frontend-design skill，我需要：
1. 在编码前思考美学方向
2. 选择大胆、独特的方向
3. 创造令人难忘且独特的设计
4. 避免通用的 AI 美学（不使用 Inter 字体、紫色渐变等）
5. 使用独特的字体、协调的色彩、动画和空间构图

设计方向：新野兽主义与日式极简主义融合
- 高对比度：温暖的米白色背景 + 深炭灰文字 + 活力珊瑚橙点缀
- 强烈的几何形状和边框
- 独特的字体配对
- 流畅但有目的的动画
- 略微非常规的布局元素

字体：
- 标题：DM Serif Display 或 Playfair Display
- 正文：Outfit 或 DM Sans

配色方案：
- 背景：温暖奶油色 (#FAF7F2)
- 主色：深炭灰 (#1A1A1A)
- 强调色：活力珊瑚橙 (#FF6B35)
- 次要色：柔和的鼠尾草绿或青绿色

差异化特性：
- 错落动画的任务卡片
- 悬停显示操作按钮
- 视觉有趣的进度指示器
- 干净但非常规的间距和边框
- 微妙的纹理叠加增加深度
```

**特点**：
- 思考更深入、系统化
- 有明确的设计哲学和方向
- 详细的设计规范（字体、配色、动画）
- 避免通用 AI 美学，追求独特性

---

### 4. 设计实现差异

#### 场景 A（无 skill）设计特点
- **背景**：渐变紫色背景
- **效果**：玻璃拟态效果卡片
- **风格**：相对通用的现代 UI 设计
- **功能**：包含优先级设置、筛选、统计等完整功能

#### 场景 B（有 skill）设计特点
- **背景**：温暖奶油色 (#FAF7F2)
- **风格**：新野兽主义 × 日式极简主义融合
- **字体**：DM Serif Display + Outfit（独特字体配对）
- **配色**：深炭灰 + 珊瑚橙 + 鼠尾草绿（高对比度配色）
- **动画**：错落滑入效果、悬停交互
- **质感**：微妙纹理叠加

---

### 5. 响应内容差异

#### 场景 A（无 skill）响应
```
完成！我已经为你创建了一个精美的 TodoList 应用 ✨

**主要特性：**
1. **精美 UI 设计**
   - 渐变紫色背景
   - 玻璃拟态效果卡片
   - 流畅的动画和过渡效果
   - 响应式设计，支持移动端
...
```

#### 场景 B（有 skill）响应
```
✨ 已创建精美的 TodoList 应用！

## 设计特色

**视觉风格**：新野兽主义 × 日式极简主义
- **配色**：温暖奶油色背景 + 深炭灰文字 + 活力珊瑚橙点缀 + 鼠尾草绿完成状态
- **字体**：DM Serif Display（标题）+ Outfit（正文）- 独特且优雅
- **质感**：微妙的噪点纹理叠加 + 渐变光晕效果

## 交互亮点
...
```

---

## 核心发现

### 1. Skill 工具的作用机制
- 当存在 `.claude/skills/frontend-design/SKILL.md` 时，Claude Code 会在工具定义中注册该 skill
- Skill 工具会提供详细的领域知识和设计指导
- 使用 Skill 工具后，会获得额外的上下文和指导信息

### 1.1 授权（allowList）与“实时热更新”
在后续实验里可以观察到：
- 第一次触发 Skill 时，会弹本地确认框（不在 API 抓包中）
- 选择 “don’t ask again” 后会把 `Skill(frontend-design)` 之类的条目写入 repo 级 `settings.local.json`
- 删除该条目后（不重启 Claude Code），再次触发 Skill 会重新弹确认，说明是 **运行时读取 allowList**（非启动时缓存）

这是 Formax 对齐的关键：权限记录需要可落盘，并在运行时实时生效/撤销。

### 2. 设计质量提升
- **无 skill**：功能完整，但设计相对通用
- **有 skill**：设计更有独特性，有明确的设计哲学，避免"AI slop"美学

### 3. 思考过程优化
- **无 skill**：直接实现，功能导向
- **有 skill**：先思考设计方向，再实现，质量导向

### 4. 执行效率
- **无 skill**：需要额外的探索步骤（ls -la）
- **有 skill**：直接调用 skill，获得指导后执行，流程更顺畅

---

## 结论

使用 Skill 工具（`.claude/skills/frontend-design/SKILL.md`）后：

1. **设计质量显著提升**：从通用设计到有独特设计哲学的实现
2. **思考更深入**：从功能实现到美学设计
3. **执行更专业**：遵循专业的设计指导原则
4. **避免通用化**：明确避免"AI slop"美学，追求独特性

Skill 工具为特定领域任务提供了专业指导和最佳实践，显著提升了输出质量。
