# Xterm.js 选区颜色塌陷与 DOM Canvas 解析坑点

最后更新：2026-03-22

在将 xterm.js 作为 UI 终端面板（如 Web 或 Electron 端基于 React 的 `TerminalPane`）时，常为了支持宿主 App 的整体外观而开启 `allowTransparency: true` 并传入 `rgba(0,0,0,0)`。但这会严重干扰 xterm 的正常选区渲染（Selection Rendering），外加 JSDOM 下 CSS 解析短板，容易产生隐蔽的显示/测试 Bug。

## 坑点 1：透明背景诱发的 Inverse Selection 塌陷（丢失语法颜色，选中区域变全黑）

### 症状
当你给 `terminal.options.theme` 指定了一个半透明选区色（例如 `selectionBackground: 'rgba(128, 128, 128, 0.3)'`），期望能像 VSCode / Codex 那样透出底层代码的彩色高亮（如 Git 的 Cyan、警告的 Red）时，在屏幕上实际看到的却是**被选中的文字底色变成了极其刺眼的深色不透明块（通常是终端的默认文字颜色），且原本的彩色语法高亮全部被抹除或反色**。

哪怕你在 CSS 层面强制用 `!important` 覆盖了 DOM 的 `.xterm-selection`，底层依然会有一层丑陋的深黑画布垫在下面。

### Root Cause (根本原因)
这是 xterm.js Canvas 渲染引擎的保底机制（Fallback）作祟。
当终端的 `options.theme.background` 被设定为纯透明（如 `transparent` 或 `'rgba(0, 0, 0, 0)'`）时，Canvas 渲染器无法预知其宿主 DOM 的真实背景色，因此它认为自己在 Canvas 上执行 `rgba` 半透明渲染是“缺乏对比度保证”或“无效的”。为了防止选区文字看不见，xterm.js 会立刻触发 **"Inverse Selection"（反色保护模式）**，直接将目标区块的 Background 和 Foreground 原地对调（用黑色字色刷背景，用白色背景刷字），从而物理破坏了你原本希望达到的透亮质感。

### 解决方案
既然 xterm 需要一块真实的底色板用以混合透明色，那就**别把终端的内部画布设为全透明**。
将终端的背景显式提取为外层 DOM 的真实不透明底色（如 CSS 中定义的 `--background` 控制值）。在 `TerminalPane` 构建 `XtermTheme` 时：

```typescript
// 错误（诱发反色丢失高亮）
background: 'rgba(0, 0, 0, 0)',

// 正确解法（供给真实不透明底色，使 xterm.js 能够安全混合选区颜色）
background: resolveColor('--vscode-terminal-background', fallback.background!),
// 此举能激活正常的半透明混合，保留底层彩色高亮。
```

---

## 坑点 2：无头浏览器/Vitest 环境下基于 Canvas `fillStyle` 探测颜色的死锁

### 症状
为了支持主题色响应式，往往会创建隐藏 `div` 插入 DOM 中 `getComputedStyle` 后，将结果交由 `canvas.getContext('2d').fillStyle` 生成 RGBA 参数。在真实浏览器里稳定好用，但放到 Vitest + JSDOM（或不存在 Canvas 的环境）的 CI 里去跑，这个逻辑会使得颜色字符串崩溃解析。

### Root Cause
1. 在 JSDOM 环境中，原生的 `getComputedStyle(el).backgroundColor` 时常退化，无法正确计算 `var(--vscode-xxx)` 的复合链路，最终直接返回纯字符串 `"var(--vscode-xxx)"`。
2. 当包含 `"var("` 的原始 CSS 字符串流入 `canvas` 检测流中，Canvas 2D API 失效或直接原路抛回。
3. 这些废弃字符串被投喂给 `terminal.options.theme` 后，导致 xterm 主题彻底崩溃回落，终端相关的测试 Snapshot 会全部漂移。

### 解决方案
在 `resolveColor` 解析钩子处必须**主动拦截 JSDOM 式的残缺 CSS 解析**。当探测到返回结果仍有未解开的 `var(` 标记时，应及时触发到 `failColor` 的后备机制，或者允许外部注入 Inline Override 进行短路计算：

```typescript
const resolveColor = (token: string, failColor: string) => {
  // 1. 提供内联逃生锚点（可用于单测等强干预场景）
  const inlineOverride = document.documentElement.style.getPropertyValue(token).trim()
  if (inlineOverride.length > 0) return inlineOverride

  // ... DOM computedStyle 获取与合法性校验 ...

  // 2. 检测 Canvas 降级产物：若 JSDOM 把 var() 原封不动吐出去了，视为解析失败回落
  const parsed = parseToRgba(rawColor)
  return !parsed || parsed.startsWith('var(') ? failColor : parsed
}
```
