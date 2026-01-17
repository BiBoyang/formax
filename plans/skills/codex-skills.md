## Skills 功能相关文件位置

### 核心技能模块
- **技能加载器**: `codex-rs/core/src/skills/loader.rs` - 负责从各个目录加载技能文件 [1](#0-0) 
- **技能管理器**: `codex-rs/core/src/skills/manager.rs` - 管理技能缓存和按目录加载 [2](#0-1) 
- **技能渲染器**: `codex-rs/core/src/skills/render.rs` - 渲染技能列表显示格式 [3](#0-2) 
- **示例技能**: `codex-rs/core/src/skills/assets/samples/skill-creator/SKILL.md` - 技能创建示例模板 [4](#0-3) 

### 核心集成点
- **主逻辑**: `codex-rs/core/src/codex.rs` - 包含 `list_skills` 函数和技能注入逻辑 [5](#0-4) 
- **项目文档**: `codex-rs/core/src/project_doc.rs` - 将技能集成到项目文档中 [6](#0-5) 
- **应用服务器**: `codex-rs/app-server/README.md` - 技能相关 API 端点文档 [7](#0-6) 

### 用户界面组件
- **TUI 技能弹窗**: `codex-rs/tui/src/bottom_pane/skill_popup.rs` - 终端界面技能选择弹窗 [8](#0-7) 
- **TUI2 聊天组件**: `codex-rs/tui2/src/bottom_pane/chat_composer.rs` - 新版终端界面技能集成 [9](#0-8) 
- **底部面板**: `codex-rs/tui/src/bottom_pane/mod.rs` - 包含技能支持的底部面板 [10](#0-9) 

### 测试文件
- **技能测试**: `codex-rs/core/tests/suite/skills.rs` - 技能功能测试用例 [11](#0-10) 

## Notes

Skills 功能是 Codex 系统中的核心扩展机制，允许用户创建自定义的工作流程和工具集成。主要文件分布在 `codex-rs/core/src/skills/` 目录下，包含加载、管理、渲染等核心功能，并在 TUI 和应用服务器中有相应的集成点。