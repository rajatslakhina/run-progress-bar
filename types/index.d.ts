// State contract of run-progress-bar: every value the mod keeps in `$.state`.
// Values outlive a hot reload, so each key is Shaped and tagged (see SHAPE in
// hooks/register.tsx); a value stored under another tag reads as the initial.

export type StepStatus = 'pending' | 'in_progress' | 'completed'

export type TaskStep = { content: string; status: StepStatus }

export type TaskState = {
  steps: TaskStep[]
  /** Index of the step being worked on, -1 when none. */
  currentIndex: number
  /** When the first step started (clock ms). */
  startedAt: number
  /** When wrap_up was seen; null while the task runs. */
  finishedAt: number | null
  updatedAt: number
}

export type AgentStatus = 'running' | 'done' | 'failed'

export type AgentView = {
  agentId: string
  label: string
  phase: string
  /** Observed start (journal line seen, or meta.json mtime when older). */
  startedAt: number
  endedAt: number | null
  status: AgentStatus
  /** mtime of agent-<id>.jsonl, null until listed. */
  lastWriteAt: number | null
  /** size of agent-<id>.jsonl, null until listed. */
  size: number | null
}

export type RunState = {
  runId: string
  dir: string
  name: string | null
  /** Phase titles from the script's meta.phases, in order; empty when unknown. */
  phases: string[]
  /** Phases in the order the journal first named them. */
  seenPhases: string[]
  startedAt: number
  agents: Record<string, AgentView>
  /** Every label of a `started` event, in order (retry detection). */
  startedLabels: string[]
  /** Greatest number of agents seen running at once. */
  maxParallel: number
  /** Characters of journal.jsonl already folded. */
  journalOffset: number
  journalSize: number
  /** full = journal parsed; list-only = journal too large, counts from meta files only. */
  mode: 'full' | 'list-only'
  corruptLines: number
  lastActivityAt: number
  isDone: boolean
  /** Phases whose duration was written to the history store. */
  recordedPhases: string[]
}

export type FlagKind = 'stalled' | 'retry' | 'growth' | 'process-gone' | 'cost'

export type Flag = { kind: FlagKind; id: string; text: string; at: number }

export type BgKind = 'shell' | 'subagent' | 'workflow' | 'monitor' | 'other'

export type BgTask = {
  id: string
  kind: BgKind
  description: string
  /** started | running | completed | failed | killed | <producer's word> */
  status: string
  startedAt: number
  endedAt: number | null
  /** The workflow run this task started, when known. */
  runId: string | null
}

export type EtaView = {
  lowMs: number
  highMs: number
  samples: number
  /** Later phases with no estimate at all. */
  unestimated: number
} | null

/** One agent's token counts summed over its completed turns (`turn.complete`). */
export type AgentTokens = {
  input: number
  output: number
  cacheRead: number
  cacheCreate: number
  turns: number
  /** The model id the API reported last; null until a turn said. */
  model: string | null
  updatedAt: number
}

/** The per-agent token map behind the saiyan theme's power bars; `main` is the session itself. */
export type TokensState = {
  /** The session model's context window in tokens; null until read. */
  window: number | null
  byAgent: Record<string, AgentTokens>
}

export type UiState = { isExpanded: boolean; dismissedAt: number | null }

export type Paths = { sessionDir: string | null; runHint: string | null }

declare module 'claude-code' {
  interface PluginState {
    'run-progress-bar': {
      task: Shaped<TaskState | null>
      run: Shaped<RunState | null>
      flags: Shaped<Flag[]>
      bg: Shaped<BgTask[]>
      cost: Shaped<number | null>
      eta: Shaped<EtaView>
      ui: Shaped<UiState>
      now: Shaped<number>
      paths: Shaped<Paths>
      error: Shaped<string | null>
      tokens: Shaped<TokensState>
    }
  }
}
