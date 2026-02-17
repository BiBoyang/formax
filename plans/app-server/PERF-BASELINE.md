# Semantic Streaming Perf Baseline

更新时间：2026-02-18

## 1. 目标

监控 canonical projection 在高频 streaming 场景下的吞吐回退风险（Blueprint `R3`）。

## 2. 基线检查命令

```bash
bun run check:semantic-streaming-perf
```

可选阈值覆盖：

```bash
FORMAX_SEMANTIC_PERF_MIN_EVENTS_PER_SEC=20000 bun run check:semantic-streaming-perf
```

## 3. 负载模型

- 线程数：1
- 回合数：600
- 每回合事件：5（assistant_delta + tool start/update/end + turn_footer）
- 总事件数：3000
- 统计：2 次 warmup + 5 次测量，取 median throughput

## 4. 默认阈值

- `median throughput >= 1000 events/s`

说明：

- 这是回归阈值，不是峰值目标。
- 若确需降低阈值，必须在变更中记录原因（机器规格、运行环境、算法变更）。
