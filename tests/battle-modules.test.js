import test from 'node:test'
import assert from 'node:assert/strict'
import { loadModule } from './helpers/modules.js'

const num = value => Number.isFinite(Number(value)) ? Number(value) : 0
const text = value => String(value ?? '')
const formatMock = { num }

test('missing players use the proper 5v5 and 10v10 team sizes', async () => {
  const slots = await loadModule('models/King/battle/slots.js', { mocks: { './format.js': formatMock } })
  assert.equal(slots.teamSlotSize(false), 5)
  assert.equal(slots.teamSlotSize(true), 10)
  assert.deepEqual({ ...slots.missingSlots(4, 5) }, { size: 5, myMissing: 1, enemyMissing: 0, missing: 1 })
  assert.deepEqual({ ...slots.missingSlots(9, 10, 10) }, { size: 10, myMissing: 1, enemyMissing: 0, missing: 1 })
  assert.equal(slots.placeholderRole().placeholder, true)
})

test('low-score badges preserve the whole-card threshold and per-team fallback', async () => {
  const slots = await loadModule('models/King/battle/slots.js', { mocks: { './format.js': formatMock } })
  const roles = [{ score: 3 }, { score: 8 }, { score: 7 }, { score: 9 }]
  const low = slots.markBotRoles(roles, 2)
  assert.equal(low[0].botLabel, '神人')
  assert.equal(low[2].isBot, undefined)
  assert.equal(roles[0].isBot, undefined)
  const fallback = slots.markBotRoles([{ score: 7 }, { score: 8 }, { score: 9 }, { score: 10 }], 2)
  assert.deepEqual(Array.from(fallback, role => Boolean(role.isBot)), [true, false, true, false])
})

test('timeline columns preserve event ordering and remove separators at each column end', async () => {
  const timeline = await loadModule('models/King/battle/timeline.js', {
    mocks: { './format.js': formatMock, '../Common.js': { toText: text }, '#yiyi.utils': { clockText: text } }
  })
  const input = Array.from({ length: 7 }, (_, id) => ({ id }))
  const columns = timeline.timelineColumns(input)
  assert.deepEqual(Array.from(columns, column => column.length), [3, 2, 2])
  assert.deepEqual(Array.from(columns.flat(), row => row.id), [0, 1, 2, 3, 4, 5, 6])
  assert.ok(columns.every(column => column.at(-1).sep === false))
  assert.equal(input[0].sep, undefined)
})

test('economy trend changes perspective for camp 2', async () => {
  const trend = await loadModule('models/King/battle/trend.js', {
    mocks: { './format.js': formatMock, '../Common.js': { toText: text }, '#yiyi.utils': { clockText: text } }
  })
  const body = { ecoDistance: [0, 1000], playBaseInfoArr: [{ playID: 'me', acntCamp: 2 }] }
  const view = trend.mapBattleTrend(body, 'me', 60)
  assert.equal(view.cells[0].lead, false)
  assert.equal(view.cells[0].lastText, '-1k')
  assert.equal(trend.mapBattleTrend({ ecoDistance: [0] }), null)
})
