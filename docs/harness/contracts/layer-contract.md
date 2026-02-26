# Layer Contract

本合同由 `scripts/check-layer-contracts.mjs` 强制执行。

## 分层顺序

`Types -> Config -> Repo -> Service -> Runtime -> UI`

规则：某一层只允许导入“本层”或“左侧层”。

附加规则：
- `UI` 不允许直接导入 `Repo`。

## 配置来源

- 映射文件：`scripts/layer-contract.config.json`
- 基线文件：`scripts/baselines/layer-contract-violations.json`

## 校验命令

- 仅检查：`bun run check:layer-contracts`
- 重新冻结基线：`node ./scripts/check-layer-contracts.mjs --write-baseline`

## 失败处理

1. 若因“新增违规”失败，优先修复导入方向或把代码移动到正确层。
2. 若违规是有意设计且已评审，先补架构说明，再更新 baseline。
3. 若出现陈旧 baseline 项，建议在同一改动中刷新 baseline，避免漂移。
