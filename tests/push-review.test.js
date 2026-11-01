import assert from 'node:assert/strict'
import test from 'node:test'
import { loadModule } from './helpers/modules.js'

async function fixture () {
  const records = new Map([
    ['user', { group: 'group-A', campId: 'role-A', roleId: 'role-A', accountId: 'account-A', battle: true, online: true, lastGameSeq: 'old' }],
    ['other', { group: 'group-B', campId: 'role-B', battle: true, lastGameSeq: 'old' }]
  ])
  const writes = []
  const fail = new Set()
  const persistence = await loadModule('models/King/push/persistence.js', {
    mocks: {
      '../core/store.js': {
        listUserIds: () => [...records.keys()],
        readUserPart: id => structuredClone(records.get(id) ?? null),
        writeUserPart: (id, part, value) => {
          writes.push(id)
          if (fail.has(id)) return false
          if (value == null) records.delete(id)
          else records.set(id, structuredClone(value))
          return true
        }
      }
    }
  })
  return { persistence, records, writes, fail }
}

test('partial write failure retries only the still-dirty user', async () => {
  const { persistence, records, writes, fail } = await fixture()
  const data = persistence.loadPushData()
  data.pushList.user.lastGameSeq = 'new'
  data.pushList.other.lastGameSeq = 'new'
  fail.add('user')
  assert.equal(persistence.savePushData(data), false)
  assert.equal(records.get('other').lastGameSeq, 'new')
  records.get('user').online = false
  fail.delete('user')
  assert.equal(persistence.savePushData(data), true)
  assert.deepEqual(writes, ['user', 'other', 'user'])
  assert.equal(records.get('user').online, false)
  assert.equal(records.get('user').lastGameSeq, 'new')
})

test('old query state cannot enter a replacement subscription target', async () => {
  const { persistence, records } = await fixture()
  const data = persistence.loadPushData()
  data.pushList.user.lastGameSeq = 'old-target-result'
  records.set('user', {
    group: 'group-new', campId: 'role-new', roleId: 'role-new', accountId: 'account-new',
    battle: true, online: false, lastGameSeq: 'new-target-cursor'
  })
  persistence.savePushData(data)
  assert.equal(records.get('user').lastGameSeq, 'new-target-cursor')
  assert.equal(records.get('user').group, 'group-new')
  assert.equal(records.get('user').online, false)
})

test('an older query cannot rewind a cursor reseeded by a newer command', async () => {
  const { persistence, records } = await fixture()
  const data = persistence.loadPushData()
  data.pushList.user.lastGameSeq = 'poll-result'
  records.get('user').lastGameSeq = 'new-command-seed'
  records.get('user').online = false
  persistence.savePushData(data)
  assert.equal(records.get('user').lastGameSeq, 'new-command-seed')
  assert.equal(records.get('user').online, false)
})

test('each group checkpoints its cursor after sending and before the next group', async () => {
  const f = await fixture()
  const text = value => String(value ?? '')
  const log = { info () {}, warn () {}, error () {}, mark () {} }
  const store = await loadModule('models/King/push/store.js', {
    mocks: {
      '#yiyi.utils': { toText: text },
      '../Profile.js': { cleanName: text, cachedVisibleRoles: () => [] },
      './persistence.js': f.persistence
    }
  })
  const events = []
  const { runPushTickInner } = await loadModule('models/King/push/tick.js', {
    mocks: {
      '#yiyi.utils': { createLogger: () => log, toText: text, sleep: async () => {}, truncInt: value => Math.trunc(Number(value) || 0) },
      '../GroupPush.js': { groupPushOn: () => true },
      '../Hidden.js': { isHiddenCamp: async () => false },
      '../Profile.js': { campRoleName: () => '角色', cleanName: text, rememberCampRoleName: () => {} },
      '../auth/pool.js': { findAccount: () => null },
      '../auth/roles.js': {
        accountCampOf: () => 'camp',
        campQueryOf: roleId => ({ campUserId: 'camp', roleId }),
        pushAccountFor: ({ owner }) => ({ id: owner })
      },
      '../auth/state.js': { ownerOf: value => value?.ownerId },
      './card.js': {
        sendPushCard: async group => {
          events.push(group)
          if (group === 'group-A') assert.equal(f.records.get('user').lastGameSeq, 'old')
          if (group === 'group-B') {
            assert.equal(f.records.get('user').lastGameSeq, 'new')
            assert.equal(f.records.get('other').lastGameSeq, 'old')
          }
          return true
        }
      },
      './fetch.js': { fetchLatest: async () => ({ list: [] }), unavailablePatch: value => value },
      './groups.js': { autoEnsureGroups: async () => 0 },
      './plan.js': {
        dedupeAccountRows: () => ({ dropped: 0 }),
        planPush: sub => ({ rows: [{ kind: 'battle' }], details: [], patch: { ...sub, lastGameSeq: 'new' } })
      },
      './rounds.js': {
        hasOnlineSignal: () => false,
        isCheckRound: () => true,
        needBattleList: () => true,
        pushRoundIndex: () => 1,
        pushTickMs: () => 120000
      },
      './state.js': { fetchOnlineState: async () => null },
      './store.js': store,
      './watch.js': { runWatchPoll: async () => {}, watchJobOf: () => null, watchPolls: new Map() },
      '../Common.js': { describeError: error => error.message, maskUserId: text }
    }
  })
  const result = await runPushTickInner({ send: async () => {} })
  assert.deepEqual(events, ['group-A', 'group-B'])
  assert.equal(result.pushed, 2)
  assert.equal(f.records.get('other').lastGameSeq, 'new')
  assert.deepEqual(f.writes, ['user', 'other'])
})
