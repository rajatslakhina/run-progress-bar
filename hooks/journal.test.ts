import { expect, test } from 'claude-code/testing'

import { currentPhase, foldEvents, newRun, parseJournal, parseMetaName, parsePhases, phaseCounts } from './journal'

const L = {
  launched: '{"type":"launched"}',
  s1: '{"type":"started","key":"v2:1","agentId":"a1","label":"research:a","phase":"Research"}',
  s2: '{"type":"started","key":"v2:2","agentId":"a2","label":"research:b","phase":"Research"}',
  r1: '{"type":"result","key":"v2:1","agentId":"a1","result":{"facts":[]}}',
  f2: '{"type":"failed","key":"v2:2","agentId":"a2"}',
}

test('journal: parses whole lines, leaves a partial last line for the next read', () => {
  const text = `${L.launched}\n${L.s1}\n${L.s2.slice(0, 20)}`
  const p = parseJournal(text, 0)
  expect(p.events.map(e => e.type)).toEqual(['launched', 'started'])
  expect(p.offset).toBe(L.launched.length + 1 + L.s1.length + 1)
  expect(p.corrupt).toBe(0)
  // the rest of the line arrives: parsing resumes at the offset without re-reading old lines
  const full = `${text}${L.s2.slice(20)}\n`
  const q = parseJournal(full, p.offset)
  expect(q.events).toHaveLength(1)
  expect(q.events[0]).toMatchObject({ type: 'started', agentId: 'a2', phase: 'Research' })
})

test('journal: corrupt, non-object, field-less and unknown lines are counted, not thrown', () => {
  const text = ['not json', '[1,2]', '"str"', '{"type":"started","label":"no-agent"}', '{"type":"future","agentId":"z"}', '', L.r1, ''].join('\n') + '\n'
  const p = parseJournal(text, 0)
  expect(p.corrupt).toBe(4)
  expect(p.skipped).toBe(1)
  expect(p.events).toEqual([{ type: 'result', key: 'v2:1', agentId: 'a1' }])
})

test('journal: fold stamps starts and ends, counts parallelism, records a retry label and a failure', () => {
  let run = newRun('wf_1', '/x', 0)
  run = foldEvents(run, parseJournal(`${L.launched}\n${L.s1}\n${L.s2}\n`).events, 1000)
  expect(Object.keys(run.agents)).toEqual(['a1', 'a2'])
  expect(run.maxParallel).toBe(2)
  expect(run.seenPhases).toEqual(['Research'])
  expect(run.agents.a1!.startedAt).toBe(1000)
  run = foldEvents(run, parseJournal(`${L.r1}\n${L.f2}\n${L.s1}\n`).events, 5000)
  expect(run.agents.a1).toMatchObject({ status: 'done', endedAt: 5000 })
  expect(run.agents.a2).toMatchObject({ status: 'failed', endedAt: 5000 })
  expect(run.startedLabels).toEqual(['research:a', 'research:b', 'research:a'])
  expect(run.lastActivityAt).toBe(5000)
  expect(phaseCounts(run)).toEqual([{ phase: 'Research', done: 1, failed: 1, running: 0, total: 2 }])
})

test('journal: a result whose start was never seen still counts', () => {
  const run = foldEvents(newRun('wf', '/x', 0), parseJournal(`${L.r1}\n`).events, 7)
  expect(run.agents.a1).toMatchObject({ status: 'done', startedAt: 7, endedAt: 7 })
})

test('journal: current phase is the latest seen phase with running agents', () => {
  let run = newRun('wf', '/x', 0)
  run.phases = ['Research', 'Design', 'Verify']
  run = foldEvents(
    run,
    parseJournal(
      [
        L.s1,
        L.r1,
        '{"type":"started","key":"k","agentId":"d1","label":"design:x","phase":"Design"}',
        '{"type":"started","key":"k2","agentId":"v1","label":"verify:x","phase":"Verify"}',
        '{"type":"result","key":"k2","agentId":"v1"}',
      ].join('\n') + '\n',
    ).events,
    1,
  )
  expect(currentPhase(run)).toBe('Design')
  expect(phaseCounts(run).map(c => c.phase)).toEqual(['Research', 'Design', 'Verify'])
})

test('meta: phases and name come out of the script literal in order', () => {
  const script = `export const meta = {
  name: 'v3-audit-and-fix',
  description: 'Read-only audits, then fixers',
  phases: [
    { title: 'Audit', detail: 'three read-only lenses' },
    { title: "Fix", detail: 'one fixer per file group' },
    { title: 'Leftovers' },
  ],
}
const DIMENSIONS = [{ title: 'not a phase' }]
`
  expect(parsePhases(script)).toEqual(['Audit', 'Fix', 'Leftovers'])
  expect(parseMetaName(script)).toBe('v3-audit-and-fix')
  expect(parsePhases('export const meta = { name: "x" }')).toEqual([])
  expect(parseMetaName('nothing here')).toBeNull()
})
