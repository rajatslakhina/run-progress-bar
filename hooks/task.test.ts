import { expect, test } from 'claude-code/testing'

import { applyPlanInput, finishTask, parseTags, textOfMessage } from './task'

const ITEMS = {
  items: [
    { content: 'Read', status: 'in_progress' },
    { content: 'Write', status: 'pending' },
    { content: 'Verify', status: 'pending' },
  ],
  scope: 'first_task',
}

test('task: items start a list; advance moves it; done and start work out of order', () => {
  let t = applyPlanInput(null, ITEMS, 1000)
  expect(t).toMatchObject({ currentIndex: 0, startedAt: 1000, finishedAt: null })
  t = applyPlanInput(t, { advance: true }, 2000)
  expect(t!.steps.map(s => s.status)).toEqual(['completed', 'in_progress', 'pending'])
  expect(t!.currentIndex).toBe(1)
  t = applyPlanInput(t, { done: [2], start: 3 }, 3000)
  expect(t!.steps.map(s => s.status)).toEqual(['completed', 'completed', 'in_progress'])
  expect(t!.currentIndex).toBe(2)
  expect(t!.startedAt).toBe(1000)
  t = applyPlanInput(t, { advance: true }, 4000)
  expect(t!.currentIndex).toBe(-1)
  expect(t!.steps.every(s => s.status === 'completed')).toBe(true)
})

test('task: wrap_up stamps the end and leaves statuses; a later move reopens the task with its original start', () => {
  let t = applyPlanInput(null, ITEMS, 1000)
  t = applyPlanInput(t, { advance: true }, 2000)
  const done = finishTask(t!, 5000)
  expect(done.finishedAt).toBe(5000)
  expect(done.steps.map(s => s.status)).toEqual(['completed', 'in_progress', 'pending'])
  const again = applyPlanInput(done, { advance: true }, 9000)
  expect(again).toMatchObject({ finishedAt: null, currentIndex: 2, startedAt: 1000 })
})

test('task: a continuation keeps the start, a new task resets it; a move before any list is ignored', () => {
  const first = applyPlanInput(null, ITEMS, 1000)
  const cont = applyPlanInput(first, { ...ITEMS, scope: 'continuation' }, 2000)
  expect(cont!.startedAt).toBe(1000)
  const fresh = applyPlanInput(cont, { ...ITEMS, scope: 'new_task' }, 3000)
  expect(fresh!.startedAt).toBe(3000)
  expect(applyPlanInput(null, { advance: true }, 1)).toBeNull()
  const same = applyPlanInput(first, {}, 7)
  expect(same).toBe(first)
})

test('task: malformed items degrade to pending placeholders', () => {
  const t = applyPlanInput(null, { items: [null, 'x', { status: 'weird' }, { content: 'ok', status: 'completed' }] }, 1)
  expect(t!.steps.map(s => `${s.content}:${s.status}`)).toEqual(['(step):pending', '(step):pending', '(step):pending', 'ok:completed'])
  expect(t!.currentIndex).toBe(-1)
})

test('notification parsing: text from string or block content; first tag of a name wins', () => {
  expect(textOfMessage({ content: 'plain' })).toBe('plain')
  expect(textOfMessage({ content: [{ type: 'text', text: 'a' }, { type: 'image' }, { type: 'text', text: 'b' }] })).toBe('a\nb')
  expect(textOfMessage(null)).toBe('')
  const tags = parseTags('<task-notification>\n<task-id>abc</task-id>\n<status>completed</status>\n<status>ignored</status>\n<summary>x <b>y</b></summary>\n</task-notification>')
  expect(tags).toEqual({ 'task-id': 'abc', status: 'completed', b: 'y' })
})
