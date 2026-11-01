import assert from 'node:assert/strict'
import test from 'node:test'
import { loadModule } from './helpers/modules.js'

async function fixture () {
  const accounts = [
    { id: 'borrowed', userId: 'camp-other', ownerId: 'other' },
    { id: 'own-other', userId: 'camp-own-other', ownerId: 'owner' },
    { id: 'exact', userId: 'camp-exact', ownerId: 'owner' },
    { id: 'invalid', ownerId: 'owner', invalid: true },
    { id: 'silenced', ownerId: 'owner', silenced: true }
  ]
  const caches = {
    owner: { exact: { roles: [{ roleId: 'role' }] }, borrowed: { roles: [{ roleId: 'role' }] } },
    other: { borrowed: { roles: [{ roleId: 'role' }] } }
  }
  let snapshots = 0
  let individualLookups = 0
  let rotateAt = 0
  const roles = await loadModule('models/King/auth/roles.js', {
    mocks: {
      '#yiyi.utils': { createLogger: () => ({}), toText: value => String(value ?? '') },
      '../core/store.js': {
        readUserPart: owner => caches[owner],
        writeUserPart: () => true,
        listUserIds: () => Object.keys(caches),
        readCache: () => ({ at: rotateAt }),
        writeCache: (file, value) => { rotateAt = value.at }
      },
      '../Common.js': { isUsableAuth: value => !value.invalid },
      './pool.js': {
        findAccount: id => { individualLookups += 1; return accounts.find(account => account.id === id) },
        listAccounts: () => { snapshots += 1; return accounts },
        loadPool: () => accounts,
        ownAccounts: owner => accounts.filter(account => account.ownerId === owner),
        publicAccounts: () => accounts
      },
      './state.js': { ownerOf: value => value?.ownerId, isSilenced: value => Boolean(value.silenced) }
    }
  })
  return { roles, snapshots: () => snapshots, lookups: () => individualLookups }
}

test('candidate lookup shares one pool snapshot and preserves ownership priority', async () => {
  const f = await fixture()
  const result = f.roles.queryAccountsFor({ owner: 'owner', roleId: 'role', accountId: 'borrowed' })
  assert.deepEqual(Array.from(result, account => account.id), ['exact', 'own-other', 'borrowed'])
  assert.equal(f.snapshots(), 1)
  assert.equal(f.lookups(), 0)
})

test('rotation changes only the order of owned accounts', async () => {
  const f = await fixture()
  const options = { owner: 'owner', roleId: 'role', rotate: true }
  assert.deepEqual(Array.from(f.roles.queryAccountsFor(options), account => account.id), ['exact', 'own-other', 'borrowed'])
  assert.deepEqual(Array.from(f.roles.queryAccountsFor(options), account => account.id), ['own-other', 'exact', 'borrowed'])
  assert.equal(f.snapshots(), 2)
  assert.equal(f.lookups(), 0)
})
