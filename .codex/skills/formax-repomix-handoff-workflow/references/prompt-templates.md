# Prompt Templates

## Template A: Static Consumer (WebGPT)
Use this when the receiver only has the bundle/text you provide.

```md
你拿到的是 **repomix 打包代码 + 描述材料**，不是可执行仓库。
请先做静态分析，不要假设你能运行任何本地命令。

## Inputs
- 代码包：`<repomix-file>`
- 需求说明：`<optional-docs>`
- 说明：路径统一使用仓库相对路径（repo-relative）

## Hard Constraints
1. 不要建议运行任何命令（包括测试、构建、lint）。
2. 不要依赖仓库外文件。
3. 不改变功能语义；先给分析再给改法。

## Required Output
1. Root Cause Model（主因 + 次因 + 证据链）
2. Option Comparison（最小改动 vs 结构改动）
3. Recommended Plan（按提交粒度）
4. Reproduction Matrix（从现有材料推导）
5. Assertion Matrix（可观测验收标准）
6. Implementation Checklist（我本地可执行）
```

## Template B: Executable Agent (Has Repo Access)
Use this when the receiver can run commands in the repository.

```md
你在本地仓库执行任务。先做 root cause 分析，再实施修复。

## Inputs
- 代码包：`<repomix-file>`（用于快速聚焦）
- 可直接读取仓库文件
- 说明：路径统一使用仓库相对路径（repo-relative）

## Hard Constraints
1. 主线问题优先，禁止顺手修 unrelated 问题。
2. 只运行相关测试，禁止 `bun run test:coverage`。
3. 保持现有用户可见语义不变，除非明确要求。

## Required Workflow
1. 先提交 Root Cause Model（1 主因 + 1~2 次因）。
2. 再给修复方案对比与推荐。
3. 先补/改测试锁行为，再改代码。
4. 列出实际执行的测试命令和结果。

## Required Output
- Changed files
- Why this fix is stable
- What remains risky
- Acceptance checklist status
```

## Template C: Quick Handoff Wrapper
Use this short wrapper before A/B template.

```md
请按“先分析、后实施”的方式处理，不要补丁式反复改动。
先交付：Root Cause Model + Option Comparison + Recommended Plan。
通过后再进入代码改动。
```
