# 2026-04-04 Preserved Segment Metadata

## 背景

在 Formax 里，compact boundary 已经存在，但 boundary 只知道：

- compact 是怎么触发的
- compact 前大概多少 token
- keep strategy 是什么
- compact 后补回了哪些状态

它还不知道：

- compact 后 continuation view 里哪一段是原样保留的
- summary + preserved tail 之间的最小恢复锚点是什么

这会让后续的 partial compact、resume、跨端解释都缺一个中间协议层。

## 这轮选择

这一轮没有直接做 Claude Code 那套完整 relink，而是先补一个最小 `preservedSegment`：

- `continuationMessageCount`
- `preservedTailMessageCount`
- `summaryFingerprint`
- `headFingerprint`
- `tailFingerprint`

它挂在 compact boundary metadata 上，由 `rebuildHistoryAfterCompaction(...)` 自动生成。

## 为什么先用 fingerprint，而不是 message id

当前 Formax 的 prompt history 并没有一套稳定、跨 replay 的 message-id 协议。

如果这一步强行上：

- transcript uuid
- parent chain
- relink graph

复杂度会明显超过 `CCA-023` 的目标，也会把 `CCA-071` 的恢复链提前拖进来。

所以这轮选择先用最小 fingerprint 元数据，把问题拆开：

1. 先让 compact output 能标识 preserved segment
2. 先让 continuation view 有最小可校验能力
3. 后续再在 `CCA-071` / `CCA-061` 里决定是否升级到更强的 relink 标识

## 这轮新增的最小恢复能力

`packages/core/src/chat/context/compact.ts` 现在新增了：

- `buildCompactPreservedSegmentMeta(...)`
- `continuationMatchesPreservedSegment(...)`

这意味着我们已经能做最小判断：

- 当前 continuation view 是否仍然匹配 boundary 声明的 preserved segment

这还不是完整 resume/relink，但已经足够成为后续恢复链的前置协议钩子。

## 一句话总结

这一步把 compact boundary 从“知道 compact 发生过”推进到了“知道 compact 后保留段长什么样”。
