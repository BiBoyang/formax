# Formax

<div align="center">

**一个功能强大的终端 AI 助手，基于 React + Ink 构建，支持工具执行、子代理系统和流式响应**

[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-≥18.0-green.svg)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

</div>

---

## 📖 简介

Formax 是一个现代化的终端 AI 聊天界面，专为开发者和技术团队设计。它提供了与 Claude AI 模型的无缝交互体验，支持丰富的工具执行能力，包括文件操作、代码编辑、Shell 命令执行、网络搜索等。通过模块化的工具系统和子代理架构，Formax 可以扩展为强大的 AI 开发助手。

### ✨ 核心特性

- 🎨 **现代化终端 UI** - 基于 React + Ink 构建的响应式界面
- 🔧 **丰富的工具生态** - 内置 20+ 工具模块（文件读写、代码编辑、Shell、搜索等）
- 🤖 **子代理系统** - 支持嵌套 AI 代理，实现复杂任务的分解和执行
- 🌊 **流式响应** - 实时显示 AI 响应，提供流畅的交互体验
- ⚡ **后台任务管理** - 支持长时间运行的后台任务和输出监控
- 🎯 **交互式提示** - 支持多选问题和用户输入收集
- 🔌 **可扩展架构** - 模块化的工具系统，易于添加新功能
- 📦 **TypeScript 全栈** - 完整的类型安全支持

## 🏗️ 架构概览

Formax 采用分层模块化架构，主要组件包括：

```
┌─────────────────────────────────────────────────────────┐
│                    Entry Points                         │
│  (cli.tsx, tool-examples.tsx)                          │
└──────────────────┬──────────────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────────────┐
│                    UI Layer                             │
│  (REPL.tsx, Components, Screens)                       │
└──────────────────┬──────────────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────────────┐
│                 Chat Engine                             │
│  (engine.ts, StreamClient, SSE Parser)                 │
└──────────────────┬──────────────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────────────┐
│                 Tool System                             │
│  (Registry, Executor, Modules, Presenters)              │
└──────────────────┬──────────────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────────────┐
│              Sub-Agent System                            │
│  (Registry, Runner, Task Handler)                       │
└──────────────────────────────────────────────────────────┘
```

### 核心模块

- **Entry Points** - CLI 入口点，初始化服务和渲染界面
- **UI Layer** - Ink 组件和屏幕，提供交互界面
- **Chat Engine** - 管理对话流程和消息循环
- **Tool System** - 工具注册、执行和结果展示
- **Sub-Agent System** - 子代理注册和执行引擎

## 🚀 快速开始

### 前置要求

- **Node.js** ≥ 18.0
- **npm** 或 **Bun**（推荐使用 Bun 以获得更好的性能）
- **Anthropic API Key**（从 [Anthropic Console](https://console.anthropic.com/settings/keys) 获取）

### 安装

```bash
# 克隆仓库
git clone <repository-url>
cd formax

# 安装依赖
bun install
# 或
npm install
```

### 配置

推荐使用交互式向导（会写入 `~/.formax/`）：

```bash
# 运行一次交互式 setup
node bin/formax.js setup
# 或（如果你已 npm link，见下方“运行”）
formax setup
```

你也可以使用环境变量（适合 CI/临时测试）：

```bash
# 必需（Anthropic）
ANTHROPIC_API_KEY2=your_api_key_here
ANTHROPIC_BASE_URL2=https://api.anthropic.com
ANTHROPIC_MODEL=claude-sonnet-4-5-20250929

# 可选配置
ANTHROPIC_TIMEOUT_MS=300000
FORMAX_LOGS_DIR=proxy/logs
FORMAX_SUBAGENTS_DIR=.agent/subagents
```

### 运行

```bash
# 方式 1：直接从仓库运行（推荐）
node bin/formax.js

# 方式 2：把本仓库链接为本机命令（仅本地，不发布）
npm link
formax

# 开发模式（使用 tsx，开发者用）
bun run dev
# 或
npm run dev

# 工具示例演示
bun run toole
# 或
npm run toole

# 构建生产版本（需要 Bun）
bun run build
```

### 排障（推荐）

```bash
formax doctor --bundle --bundle-tar
```

更多排障信息见：`docs/troubleshooting.md`

## 📚 使用指南

### 基本使用

启动后，Formax 会显示一个交互式聊天界面：

```
┌─ Formax Chat ────────────────────────┐
│ Type your message and press Enter    │
│ Press Ctrl+C to exit                 │
└──────────────────────────────────────┘

You: 帮我读取 README.md 文件

AI: [使用 read 工具读取文件...]

> _
```

### 可用工具

Formax 内置了丰富的工具模块：

#### 文件操作
- **read** - 读取文件内容
- **write** - 写入文件
- **edit** - 编辑文件（带确认提示）
- **glob** - 文件路径匹配

#### 代码操作
- **grep** - 文本搜索
- **search** - 语义搜索
- **notebookEdit** - Jupyter Notebook 编辑

#### 系统操作
- **bash** - 执行 Shell 命令（支持后台运行）
- **killShell** - 终止后台 Shell 进程
- **taskOutput** - 获取后台任务输出

#### 网络功能
- **webSearch** - 网络搜索
- **webFetch** - 网页内容获取（使用 AI 提取）

#### 任务管理
- **task** - 创建和管理子代理任务
- **todoWrite** - 任务列表管理
- **enterPlanMode** / **exitPlanMode** - 计划模式切换

#### 交互功能
- **askUserQuestion** - 多选问题提示

### 子代理系统

Formax 支持子代理（Sub-Agents），允许 AI 将复杂任务分解为子任务并委托给专门的代理执行。

子代理定义存储在 `.agent/subagents/` 目录下的 Markdown 文件中：

```markdown
# 子代理名称

## 描述
这是一个用于处理特定任务的子代理。

## 工具权限
- read
- write
- bash
```

### 后台任务

某些工具支持后台执行，适合长时间运行的任务：

```bash
# 在后台运行命令
bash --command "npm run build" --run_in_background true

# 查看后台任务输出
taskOutput --task_id <task_id>

# 终止后台任务
killShell --shell_id <shell_id>
```

## 🛠️ 开发指南

### 项目结构

```
formax/
├── src/
│   ├── entrypoints/          # CLI 入口点
│   │   ├── cli.tsx           # 主入口
│   │   └── tool-examples.tsx # 工具示例
│   ├── screens/              # Ink 屏幕组件
│   │   ├── REPL.tsx          # 主聊天界面
│   │   └── ToolExamplesScreen.tsx
│   ├── components/           # 可复用 UI 组件
│   │   ├── chat/            # 聊天相关组件
│   │   ├── tool/            # 工具相关组件
│   │   └── ui/              # 通用 UI 组件
│   ├── tools/               # 工具系统
│   │   ├── registry.ts      # 工具注册表
│   │   ├── executor/        # 工具执行器
│   │   ├── modules/         # 工具模块
│   │   ├── catalog/         # 工具规范源
│   │   ├── patches/         # 运行时补丁
│   │   ├── presenters/      # 结果展示器
│   │   └── runtime/         # 运行时管理器
│   ├── chat/                # 聊天引擎
│   │   └── engine.ts
│   ├── streaming/           # 流式客户端
│   │   └── anthropic/       # Anthropic 客户端
│   ├── subagents/           # 子代理系统
│   │   ├── registry.ts
│   │   └── runner.ts
│   ├── prompts/             # 提示词管理
│   ├── env/                 # 环境配置
│   ├── services/            # 外部服务
│   └── utils/               # 工具函数
├── proxy/                   # 代理和工具规范
│   ├── tools.json          # 工具规范 JSON
│   └── logs/               # 流量日志
├── docs/                    # 文档
├── plans/                   # 重构计划
└── tests/                   # 测试文件（与源码同目录）
```

### 添加新工具

工具模块遵循标准结构：

```
src/tools/modules/<tool-name>/
├── index.ts      # 模块工厂和规范定义
├── handler.ts    # 执行逻辑
└── presenter.tsx # 可选的 UI 展示器
```

示例：创建一个简单的工具模块

```typescript
// src/tools/modules/myTool/index.ts
import type { ToolModule } from '../../registry.js'
import { myToolHandler } from './handler.js'

export function createMyToolModule(): ToolModule {
  return {
    name: 'myTool',
    spec: {
      name: 'myTool',
      description: '我的工具描述',
      input_schema: {
        type: 'object',
        properties: {
          input: { type: 'string', description: '输入参数' }
        },
        required: ['input']
      }
    },
    handler: myToolHandler
  }
}

// src/tools/modules/myTool/handler.ts
import type { ToolHandler } from '../../executor/index.js'

export const myToolHandler: ToolHandler = async (input, context) => {
  const { input: userInput } = input as { input: string }
  // 工具逻辑
  return { result: `处理结果: ${userInput}` }
}
```

然后在 `src/tools/modules/index.ts` 中注册：

```typescript
toolRegistry.register(createMyToolModule())
```

### 代码风格

- **语言**: TypeScript ESM (`"type": "module"`)
- **缩进**: 2 空格
- **引号**: 单引号
- **分号**: 不使用分号
- **命名**:
  - `PascalCase` - 组件和类
  - `camelCase` - 函数和钩子
  - 工具模块: `createXToolModule`

### 测试

```bash
# 运行所有测试
npm test

# 监视模式
npm run test:watch

# 运行特定测试文件
npm test -- src/tools/registry.test.ts

# 运行匹配模式的测试
npm run test:watch -- -t "registry"
```

测试框架：
- **Vitest** - 测试运行器
- **ink-testing-library** - Ink UI 测试
- **fast-check** - 属性测试（如适用）

测试文件与源码同目录，使用 `*.test.ts` 或 `*.test.tsx` 命名。

## ⚙️ 配置选项

### 环境变量

#### LLM 配置
- `ANTHROPIC_API_KEY2` - Anthropic API 密钥（必需）
- `ANTHROPIC_BASE_URL2` - API 基础 URL（默认: `https://api.anthropic.com`）
- `ANTHROPIC_MODEL` - 使用的模型（默认: `claude-sonnet-4-5-20250929`）
- `ANTHROPIC_TIMEOUT_MS` - 请求超时（毫秒，默认: `300000`）

#### WebFetch 配置
- `FORMAX_WEBFETCH_MODEL` - WebFetch 使用的模型
- `FORMAX_WEBFETCH_MAX_TOKENS` - 最大 token 数（默认: `1024`）
- `FORMAX_WEBFETCH_MAX_INPUT_CHARS` - 最大输入字符数（默认: `120000`）

#### 路径配置
- `FORMAX_LOGS_DIR` - 日志目录（默认: `proxy/logs`）
- `FORMAX_SUBAGENTS_DIR` - 子代理目录（默认: `.agent/subagents`）

#### 功能开关
- `FORMAX_PATCH_TASK_TOOL` - 启用 Task 工具子代理补丁（默认: `true`）

#### 调试配置
- `ENABLE_CONSOLE_LOGGER` - 启用控制台日志服务器（默认: `true`）
- `CONSOLE_LOGGER_PORT` - 日志服务器端口（默认: `3001`）

## 📖 文档

- [架构文档](docs/ARCHITECTURE.md) - 系统架构详解
- [快速上手指南](docs/QUICK-START-GUIDE.md) - 5 分钟快速体验
- [工具执行流程](docs/TOOL-EXECUTION-WITH-CONFIRMATION.md) - 工具执行机制
- [执行流程详解](docs/EXECUTION-FLOW-DETAILED.md) - 详细执行流程

## 🤝 贡献

欢迎贡献代码！请遵循以下规范：

### 提交规范

使用 [Conventional Commits](https://www.conventionalcommits.org/) 格式：

```
feat: 添加新功能
fix: 修复 bug
refactor: 重构代码
docs: 更新文档
chore: 构建/工具变更
```

带作用域的提交：

```
refactor(chat): 重构聊天引擎
fix(tools): 修复工具执行器 bug
```

### Pull Request 流程

1. Fork 仓库
2. 创建功能分支 (`git checkout -b feat/amazing-feature`)
3. 提交更改（遵循提交规范）
4. 推送到分支 (`git push origin feat/amazing-feature`)
5. 创建 Pull Request

PR 应包含：
- 清晰的描述
- 相关 issue/计划的链接
- 运行的测试列表
- Ink UI 更改的终端截图

## 📝 许可证

[MIT License](LICENSE)

## 🙏 致谢

- [Ink](https://github.com/vadimdemedes/ink) - 终端 UI 框架
- [Anthropic](https://www.anthropic.com/) - Claude AI 模型
- [React](https://react.dev/) - UI 框架

## 📮 联系方式

如有问题或建议，请：
- 提交 [Issue](../../issues)
- 创建 [Pull Request](../../pulls)
- 查看 [文档](docs/)

---

<div align="center">

**用 AI 提升你的开发效率** 🚀

Made with ❤️ by the Formax team

</div>
