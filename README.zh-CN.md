# Formax

[English](README.md) | 简体中文

Formax 是一个 Claude Code 风格 AI 助手的开源实现，面向软件工程任务，支持 TUI 与 GUI 两种工作流。

它受到 Claude Code v2.0.67 的启发（无官方关联）。部分行为来自观测（例如网络流量）而非上游源码实现。

项目当前处于 Beta，更适合用于学习、实验与架构研究，而不是稳定的生产日常主力场景。

[![CI](https://github.com/yusifeng/formax/actions/workflows/ci.yml/badge.svg)](https://github.com/yusifeng/formax/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/yusifeng/formax/branch/main/graph/badge.svg)](https://codecov.io/gh/yusifeng/formax)
[![npm](https://img.shields.io/npm/v/@yusifeng/formax)](https://www.npmjs.com/package/@yusifeng/formax)
[![node](https://img.shields.io/badge/node-%3E%3D20-339933?logo=node.js&logoColor=white)](package.json)
[![license](https://img.shields.io/github/license/yusifeng/formax)](LICENSE)

<p align="left">
  <img src="./example-gifs/demo.gif" width="600" />
</p>

<details>
<summary><b>更多演示</b>（点击展开）</summary>

### 计划模式

<p align="left">
  <img src="./example-gifs/plan-mode.gif" width="600" />
</p>

### /init（创建CLAUDE.md）

<p align="left">
  <img src="./example-gifs/slash-init.gif" width="600" />
</p>

### 子代理与代码审查

<p align="left">
  <img src="./example-gifs/sub-agent-and-code-review.gif" width="600" />
</p>

</details>

## 安装

```bash
npm i -g @yusifeng/formax@beta
```

## 快速开始

在你的项目目录中启动：

```bash
cd /path/to/your/project
formax
```

首次运行时，Formax 会提示补全凭据与运行时配置。  
如果你想先走一遍配置向导：

```bash
formax setup
```

默认配置目录：`~/.formax/`

## 图形界面（GUI）

```bash
formax web
```

`formax web` 说明：

- `Threads` 标题栏会始终显示 `Add project` 按钮。
- 在桌面客户端（Electron）中，点击会打开系统文件夹选择器，并在所选目录创建新线程。
- 在纯浏览器模式下不支持系统目录选择；悬停按钮会提示 `仅桌面客户端可用`。

### 高级模式（可选）

```bash
formax app-server
```

为 GUI/IDE 客户端提供 JSON-RPC 服务。

```bash
formax serve
```

仅启动 WebSocket Bridge（通常用于高级调试或拆分部署）。

## 更多资料

规范与文档总览：[docs/index.md](docs/index.md)  
代码导航索引：[CODEMAP.md](CODEMAP.md)

## 当前已知缺口

工具执行行为暂不保证与 Claude Code 完全一致。`WebFetch` 与 `WebSearch` 目前存在已知稳定性与行为差异，当前版本不支持 MCP。

## 安全与限制

Formax 仍属实验性项目。请在批准前始终审查拟执行命令与文件变更。你需要对本地环境中的改动负责。

当前阶段，项目更适合学习、逆向分析与实验验证，不建议直接用于稳定生产工作流。

Provider 支持现状：

Anthropic 与 OpenAI-compatible 路径已在 setup/runtime 流程中可用。Gemini 已出现在配置界面，但运行时执行尚未完全支持。

## 许可证

MIT（见 [LICENSE](LICENSE)）。
