import { performance } from 'node:perf_hooks'
import {
  createInitialTranscriptProjectionState,
  reduceTranscriptProjection,
  type TranscriptProjectionState,
} from '../packages/core/src/features/semantics/projection/transcriptProjection'
import type { CanonicalEvent } from '../packages/core/src/features/semantics/core/canonicalEvents'

type BenchSample = {
  durationMs: number
  eventsPerSec: number
}

const THREAD_ID = 'perf-thread'
const TURN_COUNT = 600
const EVENTS_PER_TURN = 5
const TOTAL_EVENTS = TURN_COUNT * EVENTS_PER_TURN
const DEFAULT_MIN_EVENTS_PER_SEC = 1000
const WARMUP_RUNS = 2
const MEASURE_RUNS = 5

function envNumber(name: string): number | null {
  const raw = process.env[name]
  if (!raw) return null
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function buildEvent(args: {
  replaySeq: number
  turnId: string
  kind: CanonicalEvent['kind']
  source?: CanonicalEvent['source']
}): Pick<CanonicalEvent, 'threadId' | 'replaySeq' | 'eventId' | 'ts' | 'source' | 'turnId' | 'kind'> {
  return {
    threadId: THREAD_ID,
    replaySeq: args.replaySeq,
    eventId: `${THREAD_ID}:${args.turnId}:${args.kind}:${args.replaySeq}`,
    ts: '2026-02-18T00:00:00.000Z',
    source: args.source ?? 'engine',
    turnId: args.turnId,
    kind: args.kind,
  }
}

function buildSyntheticEvents(): CanonicalEvent[] {
  const out: CanonicalEvent[] = []
  let replaySeq = 0
  for (let turnIndex = 0; turnIndex < TURN_COUNT; turnIndex += 1) {
    const turnId = `turn-${turnIndex + 1}`
    replaySeq += 1
    out.push({
      ...buildEvent({ replaySeq, turnId, kind: 'assistant_delta' }),
      textDelta: `assistant-${turnIndex}`,
    })
    replaySeq += 1
    out.push({
      ...buildEvent({ replaySeq, turnId, kind: 'tool_event', source: 'tool' }),
      toolUseId: `tool-${turnIndex + 1}`,
      phase: 'start',
      toolName: 'Bash',
      paramsText: 'command=pwd',
    })
    replaySeq += 1
    out.push({
      ...buildEvent({ replaySeq, turnId, kind: 'tool_event', source: 'tool' }),
      toolUseId: `tool-${turnIndex + 1}`,
      phase: 'update',
      line: '/tmp/demo',
    })
    replaySeq += 1
    out.push({
      ...buildEvent({ replaySeq, turnId, kind: 'tool_event', source: 'tool' }),
      toolUseId: `tool-${turnIndex + 1}`,
      phase: 'end',
      summary: 'Bash completed',
      isError: false,
      result: '/tmp/demo',
    })
    replaySeq += 1
    out.push({
      ...buildEvent({ replaySeq, turnId, kind: 'turn_footer' }),
      status: 'completed',
    })
  }
  return out
}

function runOnce(events: CanonicalEvent[]): BenchSample {
  let state: TranscriptProjectionState = createInitialTranscriptProjectionState({ threadId: THREAD_ID })
  const startedAt = performance.now()
  for (const event of events) {
    state = reduceTranscriptProjection(state, event)
  }
  const durationMs = performance.now() - startedAt
  const eventsPerSec = events.length / (durationMs / 1000)
  if (state.lastReplaySeq <= 0 || state.segments.length === 0) {
    throw new Error('Projection benchmark produced invalid terminal state')
  }
  return { durationMs, eventsPerSec }
}

function toMedian(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted[middle] ?? 0
}

function toFixed(value: number): string {
  return value.toFixed(2)
}

function main(): void {
  const minEventsPerSec = envNumber('FORMAX_SEMANTIC_PERF_MIN_EVENTS_PER_SEC') ?? DEFAULT_MIN_EVENTS_PER_SEC
  const events = buildSyntheticEvents()

  for (let i = 0; i < WARMUP_RUNS; i += 1) {
    runOnce(events)
  }

  const samples: BenchSample[] = []
  for (let i = 0; i < MEASURE_RUNS; i += 1) {
    samples.push(runOnce(events))
  }

  const medianEventsPerSec = toMedian(samples.map((sample) => sample.eventsPerSec))
  const medianDurationMs = toMedian(samples.map((sample) => sample.durationMs))
  const worstDurationMs = Math.max(...samples.map((sample) => sample.durationMs))

  process.stdout.write('[semantic-perf] transcript projection benchmark\n')
  process.stdout.write(`- events: ${TOTAL_EVENTS} (${TURN_COUNT} turns x ${EVENTS_PER_TURN})\n`)
  process.stdout.write(`- median duration: ${toFixed(medianDurationMs)} ms\n`)
  process.stdout.write(`- worst duration: ${toFixed(worstDurationMs)} ms\n`)
  process.stdout.write(`- median throughput: ${toFixed(medianEventsPerSec)} events/s\n`)
  process.stdout.write(`- threshold: >= ${toFixed(minEventsPerSec)} events/s\n`)

  if (medianEventsPerSec < minEventsPerSec) {
    process.stderr.write(
      `\n[semantic-perf] failed: median throughput ${toFixed(medianEventsPerSec)} < threshold ${toFixed(minEventsPerSec)}\n`,
    )
    process.exit(1)
  }

  process.stdout.write('\n[semantic-perf] check passed\n')
}

main()
