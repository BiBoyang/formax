# Formax - Minimal Ink CLI Demo

这是一个使用 React 和 Ink 构建的最小命令行工具示例。

## 技术栈

- **TypeScript** - 类型安全
- **React** - UI 框架
- **Ink** - 命令行 UI 库（类似 React DOM，但用于终端）
- **tsx** - TypeScript 执行器
- **Bun** - 包管理器（也可以使用 npm/pnpm）

## 快速开始

### 安装依赖

```bash
bun install
# 或
npm install
```

### 运行开发模式

```bash
bun run dev
```

这会启动一个简单的 Hello World 界面，使用 Ink 渲染到终端。

### 使用标准输入（stdin）

项目支持通过管道或文件重定向传递输入：

```bash
# 管道输入
echo "Hello from stdin!" | bun run dev

# 文件重定向
echo "Hello from file!" > input.txt
bun run dev < input.txt

# 多行输入
cat <<EOF | bun run dev
第一行
第二行
第三行
EOF
```

当有 stdin 输入时，程序会显示输入内容。

## 项目结构

```
formax/
├── src/
│   ├── entrypoints/
│   │   └── cli.tsx          # 入口文件
│   └── components/
│       └── HelloWorld.tsx   # Hello World 组件
├── package.json
├── tsconfig.json
└── README.md
```

## 工作原理

1. `bun run dev` 执行 `tsx ./src/entrypoints/cli.tsx`
2. `tsx` 直接运行 TypeScript 文件（无需编译）
3. `cli.tsx` 检测是否有 stdin 输入（管道或文件重定向）
4. 如果有 stdin 输入，读取所有内容
5. 使用 Ink 的 `render()` 函数渲染 React 组件
6. `HelloWorld` 组件接收并显示 stdin 内容

### stdin 处理逻辑

- **交互式运行**（`bun run dev`）：`process.stdin.isTTY === true`，不读取 stdin
- **管道输入**（`echo "hello" | bun run dev`）：`process.stdin.isTTY === false`，读取管道内容
- **文件重定向**（`bun run dev < file.txt`）：`process.stdin.isTTY === false`，读取文件内容

## 下一步

你可以：
- 添加更多组件
- 使用 Ink 的其他组件（如 `Input`, `Select` 等）
- 添加状态管理
- 添加命令行参数解析（使用 `commander`）
- 添加交互功能

## 参考

- [Ink 文档](https://github.com/vadimdemedes/ink)
- [React 文档](https://react.dev)

