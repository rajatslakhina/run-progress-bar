# run-progress-bar

A band directly above the prompt that shows live progress of long-running agent work in the current Claude Code session, from structured data only. It answers "what step?", "how long?", "is it stuck?" at a glance, without asking Claude.

Collapsed, one line while work runs:

```
▶ Revise plan sections · step 4/8 · Revise 5/7+ · 3h42m · ~40–70m left (est) · $148   [ e: Expand ]
```

Expanded (press Expand, or `e` while the band is focused): every task-list step with its status, the workflow's phases with agents done/total and the running agent labels, background tasks, last activity, and every anomaly flag in full. While nothing runs the band keeps a dim one-line marker, `▷ idle · $12.40 this session` (turn it off with `showWhenIdle`), and shows a `✓ done` line for a minute after the task wraps up. The running line appears only while a model turn is working or a workflow or background task is live, so an aborted turn never leaves a stale "running" line.

## Install

The mod is a Claude Code plugin; this repository is also its marketplace. At the prompt of a terminal session:

```
/plugin install run-progress-bar --marketplace rajatslakhina/run-progress-bar
```

Answer `y` to add the marketplace, then pick a scope (user scope loads it in every session on the machine). From a shell:

```bash
claude plugin install run-progress-bar --marketplace rajatslakhina/run-progress-bar
```

In the desktop app, where `/plugin` does not run: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `rajatslakhina/run-progress-bar`, then **Add plugin**.

Installed at user scope it loads in every Claude Code session on this machine: the desktop app's Code tab and the terminal, new sessions at once, sessions already open after `/reload-plugins` (or a restart). It draws on the terminal and desktop surfaces; the VS Code and mobile surfaces do not draw the band above the prompt. It does not run in claude.ai chat, which has no Claude Code engine. `claude plugin list` shows it; `/plugins` enables or disables it.

To hack on it, clone the repository and add the clone's parent folder as a folder marketplace (`claude plugin marketplace add <folder>` with a `.claude-plugin/marketplace.json` there pointing at `./run-progress-bar`): the installed plugin is then read from the clone itself, and edits take effect after `/reload-plugins`.

## What it shows

| Segment | Source |
|---|---|
| Title | The `in_progress` step of the session's task list |
| `step x/y` | The task list |
| `Revise 5/7+` | Current workflow phase: agents finished / agents started so far. The `+` means the script may still spawn more; the journal cannot see queued agents |
| `3h42m` | Elapsed since the task list's first step started |
| `~40–70m left (est)` | ETA range, see below. `ETA: unknown` until the current phase has a completed agent |
| `$148` | Session cost in USD |
| `⚠ Stalled` | An anomaly flag replaces the `▶`; several flags show as `⚠ N flags` |
| `—` | A source that could not be read right now |

## Data sources (local files and engine events only, nothing leaves the machine)

- **Task list**: the `mcp__ccd_turn__update_plan` and `mcp__ccd_turn__wrap_up` tool calls, observed through a read-only `tool.call` hook. On a fresh session the list is rebuilt from the transcript's past tool uses.
- **Workflow journal**: `~/.claude/projects/<project>/<session>/subagents/workflows/<runId>/journal.jsonl`, events `launched`, `started {agentId, label, phase}`, `result`, `failed`. The journal is re-read only when its size changes, and only the lines after the last parsed one are folded. Journal events carry no timestamps, so an event's time is when the bar first saw it (within one poll interval), backfilled from file modification times.
- **Agent files** in the same directory: `agent-<id>.meta.json` (label, phase; its mtime backfills the start time) and `agent-<id>.jsonl` (its mtime is the agent's last write, its size feeds the growth check). Only the directory listing is read, never the transcripts.
- **Phases**: `~/.claude/projects/<project>/<session>/workflows/<runId>.json`, whose `script` holds the workflow's `meta` literal; the phase titles and the run's start time come from it.
- **Background tasks**: `$.agent.list()` for subagents; background `Bash` and `Workflow` tool calls for shells and runs; the engine's task-notification rows for their end.
- **Cost**: `$.session.usage().cost.usd`, refreshed on the engine's `session.measure` event.
- **ETA history**: the plugin's own store (`$.store`, a JSON file under `~/.claude`), last 200 phase durations.

The session directory comes from the `transcript_path` the classic `UserPromptSubmit` hook carries, with a fallback derived from the session id and project root.

## How the ETA is computed

1. Samples = durations of agents that completed in the current phase (durations shorter than one poll interval are discarded as noise).
2. Each running agent still needs `max(0, q − elapsed)` for `q` = the 25th and 75th percentile of the samples. Agents that fit in one parallel wave (the most agents ever seen running at once in this run) finish together, so their remaining times are combined by `max`; more than a wave are summed and divided by the parallelism.
3. Later phases are added from the store's history: the median duration of that phase in past runs of the same workflow name, else of any workflow with that phase title. A phase with no history counts as unestimated and the label says so.
4. The result is shown as a range rounded to 5 minutes, always labelled `(est)`. No completed sample in the current phase means `ETA: unknown`. One sample collapses the range to one value, labelled `(est, 1 sample)`.

The expanded view prints the basis of every estimate.

## Anomaly flags

| Flag | Rule |
|---|---|
| Stalled | A running agent whose `agent-<id>.jsonl` (or start) is older than `stallMinutes` (default 10) |
| Retry | The same agent label `started` twice in one run |
| Output growth | A file in `watchFiles` grew more than `growthPercent` (default 50) within 30 minutes; an agent transcript only once it is over 20 MB |
| Process gone | A `failed` journal event, a subagent in `failed`/`killed` state, or a background task whose notification says so |
| Cost | Session cost reached `costThresholdUsd` (default 100); re-raised every 50 above it |

Each flag raises one toast when it first appears and stays listed while its condition holds.

## Configuration

Rows in the config menu (`userConfig`): `pollSeconds` (3), `stallMinutes` (10), `growthPercent` (50), `costThresholdUsd` (100), `showWhenIdle` (on: the dim idle marker), `watchFiles` (comma-separated absolute paths), `theme` (`classic`; `saiyan` adds the avatar row, see Theme), `motion` (`on`/`off`: off disables every animation of the saiyan theme), `debug` (off: a load toast, counters on the idle line, and a per-tick snapshot written to the mod's store file under `~/.claude/plugins/store/`).

## Layout on the desktop

The desktop draws a proportional font, so the expanded panel is laid out rather than padded: rows are chips spaced by the layout (no ` · ` between them), every row starts with a two-cell mark column so the text lines up, a long row wraps inside its text column while the mark column stays put, and the rows sit under small section titles (Cast, Steps, Workflow, Background, Flags) with room between sections; the titles replace the rows' own prefixes, so nothing reads "Background" twice. A band taller than the slot scrolls in the engine's own window (wheel, or the arrow keys while the band is focused); there is no horizontal scroll in the mod API, hence the wrapping. The current step's mark is `›` (classic) or a small breathing dot (saiyan). The terminal keeps its monospaced columns and glyphs.

## Theme

A drawn theme puts the session's own avatar at the head of the collapsed line (asleep while you have the turn, awake while the model works, its power level filling as the context does) and, while a workflow run has agents, a Cast section at the top of the expanded panel: one original avatar per agent, 24 px, with its label beside it. With no agents there is no Cast section. `classic` (the default) draws glyphs and no avatars. Set the theme in the plugin's config row, then `/reload-plugins`. Every theme draws the same cast, states, power level, step marks and animation cap; only the idiom changes:

| Theme | Idiom | Power level |
|---|---|---|
| `saiyan` | soft rounded shapes with a face, pastel hues, a breathing aura | thin ring |
| `pixel` | 10×10 sprites of 2 px cells lit from the top-left, stepped two-frame motion | five-segment bar |
| `ink` | one ink on a round of paper, a brush stroke with a thin echo, a vermilion seal for the rival | vermilion arc |
| `mecha` | angular plates in the role hue, a visor slit whose light is the state, a thruster glow while running | eight-segment gauge |
| `neon` | glowing outline on dark glass, a face of light, bloom that breathes | dotted ring |

The drawing modules are `hooks/cast.ts` (saiyan) and `hooks/theme-*.ts`, registered in `hooks/themes.ts`; `hooks/theme-kit.ts` holds what they share. The terminal row is the same text chips under every theme.

Who is who comes from the agent label's prefix before `:` (`review:bugs` is a rival). Each role has a fixed soft hue and its own shape, so color is never the only signal.

| Label prefix | Role | Shape (terminal glyph) |
|---|---|---|
| the session itself | gold mentor | circle `●` |
| `design`, `write` | orange fighter | triangle `▲` |
| `review`, `verify`, `skeptic` | blue rival | diamond `◆`, with a seat badge: the prefix's initial |
| `judge`, `synth` | green sage | hexagon `⬢` |
| `research` | cyan scout | chevron `❯` |
| `fix` | purple engineer | octagon `⬣` |
| `qa`, `test` | red guard | shield `⬟` |
| anything else | grey chip | square `■` |

A prefix matches a keyword it starts with (`reviewer:perf` is a rival); a label without `:` is its own prefix. The mapping lives in `hooks/roles.ts`.

What an agent does is its expression (each theme in its own idiom; in `saiyan`): idle rests with closed eyes, dimmed; running has open eyes, a small smile and a soft aura that breathes (and blinks now and then); done smiles with happy eyes and a sparkle; failed frowns with a sweat drop inside a rose outline; stalled (the stall flag) has a flat mouth, a sliding sweat drop and a slow fade. No crosses, no flashing. On the desktop each avatar is an `Svg` whose animation is SMIL inside the markup, no script, every motion on a 2 s or slower ease. At most six avatars animate at once, the earliest-started moving ones; the rest draw their still frame. `motion=off` disables every animation (the step marks' too), and nothing is drawn interactive then. The terminal has no `Svg`, so the same row is text chips: glyph, label, a state glyph (`·` idle, `›` running, `✓` done, `✗` failed, `⚠` stalled) and a five-cell power bar.

The thin ring around each avatar is its power level: tokens that entered the agent's context so far, over the model's context window, as an arc from the top. The counts come from the engine's `turn.complete` event, summed per agent (uncached input, cache writes and output; cache reads re-read the prefix on every call and are left out), the window from `$.session.usage()`. Until an agent has a count there is no ring. The map keeps the last 64 agents.

Each avatar's `alt` reads "role, label, state" (`blue rival, review:bugs, stalled`). The row shows at most 16 avatars and counts the rest. The cast is original archetypes: no real characters, names or art.

## Keyboard

Focus the band (click, or ctrl+x tab), then `e` expands, `c` collapses, `x` dismisses the finished line. Esc returns to the prompt. The engine's own `[-]` collapses the whole band.

## Tests

`claude plugin test <this folder>` runs `hooks/*.test.ts`: ETA with zero, one and many samples and with later phases; stall detection at the threshold; retry detection; output growth inside and outside the window; cost steps; flag merging; journal parsing of partial, corrupt, field-less and unknown lines, offset continuation, folding, and `meta.phases` extraction; for the theme, role mapping from label prefixes, power-level math and the token fold, the six-animation cap with motion on and off, the SVG's state marks and alt text, and the terminal chip row.

## Known limits

- Times are observation times: a journal event is dated when the bar first saw it (every `pollSeconds`), so durations carry that much error. Agents that finish inside one poll interval give no usable sample.
- The journal cannot see queued agents, so a phase total grows as the script spawns; hence the `+`.
- `$.fs.read` refuses files over 4 MiB. A journal that large switches the bar to list-only mode: agent counts and labels come from the meta files, no result events, no stall flags, and the band says so.
- Workflow agents are not in `$.agent.list()`; the journal is their only live view. Subagents dropped from the list without a notification show as `ended`.
- A background shell that never produces a task-notification row stays "started … no report yet"; the bar never guesses it finished.
- Whether the host keeps a cost ledger is the host's: without one the cost shows `$—`.
- The growth window and the history cache live in module memory, so a hot reload empties them (refilled within 30 minutes and on the next tick).
- No reduced-motion query exists in the mod API: `motion` is a user option.
- Power levels count the `turn.complete` events seen since the mod loaded, so the session's own bar misses what came before, and an agent that ended before the theme was on has no bar.
