# Desktop Window Transparency Construct（唯一事实源）

最后更新：2026-03-20  
状态：规范性（Normative）

本文档定义桌面端“窗口透明”能力的构造约束（construct），作为实现与回归修复的唯一依据。

范围：
- 桌面端透明状态定义与状态机（仅 `off` / `on` 两态）
- 主进程与渲染进程通信边界（IPC 单向职责）
- 页面分层与视觉构造（全局透明底、左侧继承全局底色、右侧白底、左上/左下圆角透明）
- 透明切换的交互一致性与验收标准

不在范围内：
- 非桌面端（纯 web）视觉方案
- 线程列表业务逻辑、菜单项业务逻辑
- 与透明无关的主题系统重构

相关实现锚点：
- `packages/desktop-electron/src/main.ts`
- `packages/desktop-electron/src/preload.ts`
- `packages/desktop-electron/src/windowAppearanceState.ts`
- `packages/web-reference-react/src/app/ui/AppShell.tsx`
- `packages/web-reference-react/src/styles.css`

规范关键字约定：
- `MUST`、`SHOULD`、`MAY` 采用 RFC 2119 语义。

## 1. 状态模型（两态）

`TRN-001`  
窗口透明状态 MUST 只有两种：
1. `off`：不透明展示态
2. `on`：透明展示态

`TRN-002`  
实现 MUST NOT 引入第三种用户态（例如 `css/native`）作为业务语义状态。  
渲染实现细节可以存在，但不得成为对外可见状态。

`TRN-003`  
状态载荷 MUST 保持：
- `revision: number`
- `windowTransparencyEnabled: boolean`

## 2. 单一真值源（主进程）

`TRN-101`  
透明状态的唯一真值 MUST 在主进程。  
渲染进程只可“请求切换/读取状态”，不得自持独立真值并长期偏离主进程。

`TRN-102`  
渲染进程点击“切换透明”后 MUST 通过 IPC 发送 `set-window-transparency` 请求；  
主进程处理后 MUST 回传并广播最新状态。

`TRN-103`  
渲染层展示态 MUST 以主进程返回状态为准。  
本地临时 pending 仅用于交互反馈，完成后 MUST 收敛到主进程状态。

`TRN-104`  
状态持久化（若启用）MUST 发生在主进程；  
渲染进程 MUST NOT 直接写持久化状态文件。

## 3. 视觉构造（全局透明，不是仅左侧透明）

`TRN-201`  
透明 `on` 时，页面底层语义 MUST 是“整窗背景透明”。  
即：透明是全局背景能力，不是“只让左侧透明”。

`TRN-202`  
右侧主内容区不透明效果 MUST 通过右侧自身表面层（如白色 surface）提供，  
而不是通过关闭整窗透明来伪装。

`TRN-203`  
左侧容器层（sidebar panel / host / header / footer）MUST 不提供独立背景色。  
左侧可见底色 MUST 来自全局背景层（Layer 1）继承。

`TRN-203A`  
左侧视觉变化 SHOULD 仅来自 Item 组件状态（hover/active/selected 等），  
MUST NOT 通过“给左侧容器单独上底色”实现对比度。

`TRN-204`  
右侧白底容器在透明 `on` 时 MUST 使用“左上角 + 左下角”圆角几何。  
右侧白底以外区域 MUST 回落到整窗透明底语义。

`TRN-205`  
左右交界 SHOULD 直接由左右两侧真实容器边界形成。  
实现 MUST NOT 额外叠加“过渡条/渐变条/伪边框层”来制造过渡。

## 4. 分层模型（建议实现）

`TRN-301`  
建议分层如下（语义层，不限定具体类名）：
1. Layer 0：窗口底层（桌面壁纸可见层，`on` 时透明）
2. Layer 1：应用全局背景层（跟随透明状态）
3. Layer 2：左侧内容承载层（透明容器，仅承载布局与交互，不承载底色）
4. Layer 3：右侧内容实底层（不透明白底/主题底，左上/左下圆角）

`TRN-302`  
MUST NOT 增加独立的 Layer 4 过渡层。  
不得通过“固定宽度高亮渐变条”覆盖全高，避免出现肉眼可见白条。

## 5. 交互与生命周期

`TRN-401`  
首次加载时，渲染进程 MUST 主动 `get-state`，并订阅主进程状态广播。

`TRN-402`  
快速连续点击切换时，命令可排队，但最终展示 MUST 与主进程最终 revision 一致。

`TRN-403`  
切换透明 MUST 不依赖手动刷新页面才能生效。

## 6. 验收标准（必须满足）

`TRN-501`  
透明 `on`：整窗底层透明；右侧为不透明白底且仅左上/左下圆角；  
圆角切出的区域显示全局透明底，不出现伪过渡条。

`TRN-502`  
透明 `off`：整页不出现透出桌面壁纸的区域。

`TRN-503`  
`off -> on -> off` 连续切换后，不出现：
1. 发白竖带
2. 悬浮边框条
3. 状态显示与真实效果不一致
4. 需要刷新才能恢复正常

`TRN-504`  
设置页、线程页、输入区同样遵守上述语义，不得“页面 A 正常、页面 B 断层”。

## 7. Codex.css 学习映射（透明策略）

本节把 `packages/web-reference-react/src/css/codex.css` 中透明相关策略映射到本构造，避免再次跑偏。

`TRN-601`  
Codex 透明态通过“状态类驱动已有层”完成，不额外创建独立过渡条层。  
对应参考：`.window-fx-celebration .main-surface`、`.window-fx-celebration .app-header-tint`、`.window-fx-celebration .sidebar-resize-handle-line`。

`TRN-602`  
Codex 在透明态把主表面改为透明并移除额外装饰（背景图、阴影等），本项目 MUST 继承这一原则：  
优先调整既有容器表面语义，禁止新增“悬浮白条/伪边框条”。

`TRN-603`  
Codex 对 header tint、divider、resize-handle 的处理是“减法”（透明/隐藏）而不是“加法”（新增视觉层），  
本项目在透明态切换时 SHOULD 采用同样的减法策略，避免条纹和闪屏。

`TRN-604`  
Codex 允许受控 transition，但 transition 目标是已有元素的颜色/不透明度。  
本项目 MUST NOT 把 transition 实现为跨整高固定渐变条。

`TRN-605`  
Codex 学习是“策略借鉴”，不是“像素复刻”。  
本项目仍以本构造几何为准：`整窗透明底 + 右侧白底（左上/左下圆角）`。

`TRN-606`  
借鉴 Codex 透明可读性策略，透明态全局底色 SHOULD 使用“高占比混合”而非超低 alpha。  
建议区间：`92% ~ 95%`（如 `rgba(..., 0.94)`），目标是保留透明语义并降低后景文本可读性到“不可抢眼”。

`TRN-607`  
在任何透明态下，左侧容器链路（panel / host / topbar / bottombar）MUST 维持 `background: transparent`；  
若需要强调结构，只能通过 Item 状态色、字重、图标对比和间距实现。

`TRN-608`  
透明态着色 MUST 采用“单层着色原则”：  
只能在一个根层容器（推荐 app-shell 根层）施加半透明底色；  
`root/body/#root` 不得在透明态再叠加同色半透明底，以避免 alpha 叠乘导致视觉近似不透明。

`TRN-609`  
透明态色值 SHOULD 优先使用固定 RGBA，而不是依赖主题 token 的 `color-mix` 推导。  
原因：主题 token 差异会导致跨主题透明观感漂移，无法稳定对齐 Codex 目标观感。

## 8. 变更流程

当透明能力、IPC 协议、圆角几何或分层关系发生变化时：
1. 先更新本构造文档。
2. 再更新主进程/预加载/渲染实现。
3. 最后补充回归测试（状态同步 + 视觉断层防回归）。

若实现与本文档冲突，应视为实现漂移并优先修正实现。
