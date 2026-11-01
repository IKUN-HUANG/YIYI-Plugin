import assert from 'node:assert/strict'
import test from 'node:test'
import { loadModule } from './helpers/modules.js'

async function fixture (count = 3) {
  const records = new Map(Array.from({ length: count }, (_, i) => [String(i), {
    group: 'g', battle: true, online: true, lastGameSeq: 'old', roles: { r: { lastGameSeq: 'old' } }
  }]))
  const writes = []
  let scans = 0
  let fail = false
  const store = await loadModule('models/King/push/persistence.js', {
    mocks: {
      '../core/store.js': {
        listUserIds: () => { scans += 1; return [...records.keys()] },
        readUserPart: id => structuredClone(records.get(id) ?? null),
        writeUserPart: (id, part, value) => {
          if (fail) return false
          writes.push(id)
          if (value == null) records.delete(id)
          else records.set(id, structuredClone(value))
          return true
        }
      }
    }
  })
  return { store, records, writes, scans: () => scans, fail: value => { fail = value } }
}

test('100 subscriptions save once per changed user, without rescanning', async () => {
  const f = await fixture(100)
  const data = f.store.loadPushData()
  for (const sub of Object.values(data.pushList)) sub.lastGameSeq = 'new'
  assert.equal(f.store.savePushData(data), true)
  assert.equal(f.writes.length, 100)
  assert.equal(f.scans(), 1)
  assert.equal(f.store.savePushData(data), true)
  assert.equal(f.writes.length, 100)
})

test('old poll snapshot preserves newer flags and new subscriptions', async () => {
  const f = await fixture()
  const data = f.store.loadPushData()
  f.records.get('0').battle = false
  f.records.set('new', { group: 'g', battle: true })
  data.pushList['0'].lastGameSeq = 'new'
  assert.equal(f.store.savePushData(data), true)
  assert.equal(f.records.get('0').battle, false)
  assert.equal(f.records.get('0').lastGameSeq, 'new')
  assert.ok(f.records.has('new'))
  assert.deepEqual(f.writes, ['0'])
  data.pushList['0'].lastGameSeq = 'newer'
  f.store.savePushData(data)
  assert.equal(f.records.get('0').battle, false)
})

test('old poll cannot recreate a cancelled subscription', async () => {
  const f = await fixture()
  const data = f.store.loadPushData()
  f.records.delete('0')
  data.pushList['0'].lastGameSeq = 'new'
  f.store.savePushData(data)
  assert.equal(f.records.has('0'), false)
  assert.equal(f.writes.length, 0)
})

test('nested role patches preserve concurrent role fields', async () => {
  const f = await fixture()
  const data = f.store.loadPushData()
  f.records.get('0').roles.r.pendingDetail = ['latest']
  data.pushList['0'].roles.r.lastGameSeq = 'new'
  f.store.savePushData(data)
  assert.deepEqual(f.records.get('0').roles.r, { lastGameSeq: 'new', pendingDetail: ['latest'] })
})

test('pruning old role state does not remove a role refreshed by a newer command', async () => {
  const f = await fixture()
  const data = f.store.loadPushData()
  delete data.pushList['0'].roles.r
  f.records.get('0').roles.r.lastGameSeq = 'new-command-seed'
  f.store.savePushData(data)
  assert.equal(f.records.get('0').roles.r.lastGameSeq, 'new-command-seed')
})

test('failed writes remain dirty and explicit removal affects only that user', async () => {
  const f = await fixture()
  const data = f.store.loadPushData()
  delete data.pushList['0']
  f.fail(true)
  assert.equal(f.store.savePushData(data), false)
  assert.ok(f.records.has('0'))
  f.fail(false)
  assert.equal(f.store.savePushData(data), true)
  assert.equal(f.records.has('0'), false)
  assert.deepEqual(f.writes, ['0'])
})

test('mutating loaded roles cannot modify the backing document before saving', async () => {
  const f = await fixture()
  const data = f.store.loadPushData()
  data.pushList['0'].roles.r.lastGameSeq = 'new'
  assert.equal(f.records.get('0').roles.r.lastGameSeq, 'old')
})
