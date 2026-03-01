# Layer Contract

本合同由以下脚本联合强制执行：
- `scripts/check-layer-contracts.mjs`
- `scripts/check-layer-coverage.mjs`
- `scripts/check-shared-types.mjs`

## 分层顺序

`Types -> Config -> Repo -> Service -> Runtime -> UI`

规则：某一层只允许导入“本层”或“左侧层”。

附加规则：
- `UI` 不允许直接导入 `Repo`。

## 映射覆盖率（强约束）

- `scanRoots` 下所有非测试源码文件必须命中某一层映射。
- 不允许“未映射文件”被静默跳过。
- 该规则由 `scripts/check-layer-coverage.mjs` 直接阻断，无 baseline。

## Shared Types 共享门槛（强约束）

- 约束目录：`src/platform/types/shared/**`。
- 若 shared type 被 `src/features/<name>/` 消费，则必须被至少 2 个不同 feature 消费。
- 若仅被 1 个 feature 消费，应回迁到该 feature 的 `types/` 目录。
- 该规则由 `scripts/check-shared-types.mjs` 直接阻断，无 baseline。

## 配置来源

- 映射文件：`scripts/layer-contract.config.json`
- 基线文件：`scripts/baselines/layer-contract-violations.json`

## allowedImports（入口白名单）

- `allowedImports` 用于声明“已评审且暂时允许”的单条跨层导入。
- 条目必须精确到 `(source, target, rule)`，并写明 `reason`。
- 该机制仅用于入口/装配型跨层依赖，不用于批量绕过分层治理。
- `check-layer-contracts` 会输出 `staleAllowedImports`，表示该白名单项已不再命中，可清理。

## 校验命令

- 仅检查：`bun run check:layer-contracts`
- 覆盖率检查：`bun run check:layer-coverage`
- shared types 检查：`bun run check:shared-types`
- 重新冻结基线：`node ./scripts/check-layer-contracts.mjs --write-baseline`

## 失败处理

1. 若因“新增违规”失败，优先修复导入方向或把代码移动到正确层。
2. 若违规是有意设计且已评审，先补架构说明，再更新 baseline。
3. 若出现陈旧 baseline 项，建议在同一改动中刷新 baseline，避免漂移。
4. 若 `staleAllowedImports > 0`，在同一改动中清理无效白名单，避免白名单漂移。
5. 若 `check:layer-coverage` 失败，必须补齐 `layer-contract.config.json` 映射，不允许绕过。
6. 若 `check:shared-types` 失败，优先将类型下沉回单 feature；确需共享时补充第二个 feature 消费点。
