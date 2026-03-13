# Anthropic `/v1/messages` “伪负载上限”排障（signature + header routing）

日期：2026-02-19

## 现象
- 上游返回 `500 new_api_error`，提示“模型负载已达上限”，但同 key 在官方链路可用。
- 在 Formax 链路中常见“第 N 轮（例如第 3/4 轮）突然失败”。

## 本次确认的两个独立问题

### 1) 历史消息里 `thinking.signature` 丢失（协议字段缺失）
- 症状：
  - 某轮正常返回 thinking；下一轮携带历史时失败。
  - 常见为“前几轮正常，后面突然 500”。
- 根因：
  - SSE 解析阶段未完整累积 `signature_delta`；
  - 回写 assistant 历史时未透传 `thinking.signature`。
- 修复落点：
  - `packages/core/src/prompts/types.ts`
  - `packages/core/src/streaming/anthropic/sseParser.ts`
  - `packages/core/src/streaming/anthropic/StreamClient.ts`
- 参考提交：
  - `7e0fc12 fix(streaming): preserve thinking signature in history`

### 2) header profile 影响上游路由/策略（主请求）
- 在主请求（非 auto-title）中，header 组合会明显影响稳定性。
- 本次主请求稳定 profile（已落主代码）：
  - `accept: application/json`
  - `accept-encoding: gzip, deflate, br, zstd`
  - 移除 `x-api-key`
  - 移除 `x-stainless-helper-method`
  - `x-stainless-package-version: 0.74.0`
  - `x-stainless-runtime-version: v24.3.0`
  - `x-stainless-timeout: 3000`
  - thinking header:
    `anthropic-beta: claude-code-20250219,adaptive-thinking-2026-01-28,prompt-caching-scope-2026-01-05,effort-2025-11-24`
- 参考提交：
  - `189e61d fix(streaming): align anthropic headers with stable profile`

## 重要：不要把 auto-title 请求混入主链路统计
- auto-title 请求通常特征：
  - `tools = 0`
  - `thinking = false`
  - 首条用户文本包含 `Please write a 5-10 word title`
- 这些请求可独立失败，会污染“主请求 header A/B”的结论。

## 推荐调试流程（复用）
1. 先分流样本：主请求 vs auto-title。
2. 仅在主请求集合上做 A/B（每组建议 6-10 次）。
3. 用“从成功配置做减法”的二分法，不要从失败配置做加法。
4. 每轮记录：
   - header 组合
   - 是否含 thinking / tools 数
   - `status` 统计
   - 失败 request id + 抓包文件路径
5. 若出现“第 N 轮失败”，优先检查历史中的 `thinking.signature` 是否完整透传。

